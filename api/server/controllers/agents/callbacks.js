const { nanoid } = require("nanoid");
const { sendEvent } = require("@aipyq/api");
const { logger } = require("@aipyq/data-schemas");
const {
  Tools,
  StepTypes,
  FileContext,
  ErrorTypes,
} = require("@aipyq/data-provider");
const {
  EnvVar,
  Providers,
  GraphEvents,
  getMessageId,
  ToolEndHandler,
  handleToolCalls,
  ChatModelStreamHandler,
} = require("@aipyq/agents");
const { processFileCitations } = require("~/server/services/Files/Citations");
const { processCodeOutput } = require("~/server/services/Files/Code/process");
const { loadAuthValues } = require("~/server/services/Tools/credentials");
const { saveBase64Image } = require("~/server/services/Files/process");

class ModelEndHandler {
  /**
   * @param {Array<UsageMetadata>} collectedUsage
   */
  constructor(collectedUsage) {
    if (!Array.isArray(collectedUsage)) {
      throw new Error("collectedUsage must be an array");
    }
    this.collectedUsage = collectedUsage;
  }

  finalize(errorMessage) {
    if (!errorMessage) {
      return;
    }
    throw new Error(errorMessage);
  }

  /**
   * @param {string} event
   * @param {ModelEndData | undefined} data
   * @param {Record<string, unknown> | undefined} metadata
   * @param {StandardGraph} graph
   * @returns {Promise<void>}
   */
  async handle(event, data, metadata, graph) {
    if (!graph || !metadata) {
      console.warn(`Graph or metadata not found in ${event} event`);
      return;
    }

    /** @type {string | undefined} */
    let errorMessage;
    try {
      const agentContext = graph.getAgentContext(metadata);
      const isGoogle = agentContext.provider === Providers.GOOGLE;
      const streamingDisabled = !!agentContext.clientOptions?.disableStreaming;
      if (data?.output?.additional_kwargs?.stop_reason === "refusal") {
        const info = { ...data.output.additional_kwargs };
        errorMessage = JSON.stringify({
          type: ErrorTypes.REFUSAL,
          info,
        });
        logger.debug(`[ModelEndHandler] Model refused to respond`, {
          ...info,
          userId: metadata.user_id,
          messageId: metadata.run_id,
          conversationId: metadata.thread_id,
        });
      }

      const toolCalls = data?.output?.tool_calls;

      // 详细记录LLM返回的tool calls（特别是speckit工具）
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        const speckitCalls = toolCalls.filter(
          (tc) => tc.function?.name === "speckit",
        );

        if (speckitCalls.length > 0) {
          logger.info(
            "[Agent-LLM交互] ========== LLM返回工具调用请求 ==========",
          );
          const speckitInfo = {
            totalToolCalls: toolCalls.length,
            speckitCallsCount: speckitCalls.length,
            threadId: metadata.thread_id,
            runId: metadata.run_id,
            userId: metadata.user_id,
            timestamp: new Date().toISOString(),
          };
          logger.info(
            `[Agent-LLM交互] LLM决定调用speckit工具: ${JSON.stringify(speckitInfo, null, 2)}`,
          );

          speckitCalls.forEach((tc, index) => {
            const parsedArgs = (() => {
              try {
                return typeof tc.function?.arguments === "string"
                  ? JSON.parse(tc.function?.arguments)
                  : tc.function?.arguments;
              } catch {
                return tc.function?.arguments;
              }
            })();
            const toolCallInfo = {
              toolCallId: tc.id,
              functionName: tc.function?.name,
              rawArguments: tc.function?.arguments,
              argumentsType: typeof tc.function?.arguments,
              parsedArguments: parsedArgs,
              // 记录完整的tool call对象，包括LLM生成的所有字段
              fullToolCall: {
                id: tc.id,
                type: tc.type,
                function: {
                  name: tc.function?.name,
                  arguments: tc.function?.arguments,
                },
              },
            };
            logger.info(
              `[Agent-LLM交互] Speckit工具调用 #${index + 1}: ${JSON.stringify(toolCallInfo, null, 2)}`,
            );

            // 特别记录arguments的生成过程
            logger.info(`[Agent-LLM交互] Arguments生成详情 #${index + 1}:`, {
              step: "LLM原始响应",
              toolCallId: tc.id,
              rawArgumentsString: tc.function?.arguments,
              argumentsLength:
                typeof tc.function?.arguments === "string"
                  ? tc.function?.arguments.length
                  : 0,
              isJSON: (() => {
                try {
                  JSON.parse(tc.function?.arguments || "");
                  return true;
                } catch {
                  return false;
                }
              })(),
              parsedResult: parsedArgs,
            });
          });

          // 记录LLM的完整响应上下文（帮助理解LLM为什么生成这些arguments）
          logger.info(
            `[Agent-LLM交互] LLM完整响应上下文: ${JSON.stringify(
              {
                totalToolCalls: toolCalls.length,
                allToolCalls: toolCalls.map((tc) => ({
                  id: tc.id,
                  type: tc.type,
                  function: {
                    name: tc.function?.name,
                    arguments: tc.function?.arguments,
                  },
                })),
                modelResponse: {
                  content: data?.output?.content,
                  stopReason: data?.output?.stop_reason,
                },
              },
              null,
              2,
            )}`,
          );

          logger.info("[Agent-LLM交互] ========== 准备执行工具调用 ==========");
        }

        // Debug: Log raw tool calls from ModelScope API response
        logger.debug("[ModelEndHandler] Raw tool calls from API response:", {
          toolCallsCount: toolCalls.length,
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            functionName: tc.function?.name,
            functionArguments: tc.function?.arguments,
            argumentsType: typeof tc.function?.arguments,
            argumentsIsEmpty:
              tc.function?.arguments === "" ||
              tc.function?.arguments === null ||
              tc.function?.arguments === undefined,
          })),
        });
      }

      let hasUnprocessedToolCalls = false;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        try {
          // 检查未处理的工具调用：
          // 1. 有 id 但尚未处理（不在 toolCallStepIds 中）
          // 2. 有名字但没有ID（有些供应商比如DashScope在直播时可能会返回不完整的 tool_calls ID）
          // 3. 工具调用被注册但未被调用（dashscope stream 问题）
          hasUnprocessedToolCalls = toolCalls.some((tc) => {
            // 情况1：已识别但尚未处理（toolCallStepIds 中未处理）
            if (
              tc?.id &&
              graph?.toolCallStepIds?.has &&
              !graph.toolCallStepIds.has(tc.id)
            ) {
              logger.debug(
                "[ModelEndHandler] 发现未处理tool_call（未在stepID中）：",
                {
                  id: tc.id,
                  name: tc.name,
                },
              );
              return true;
            }
            // 情况二：有名字但没有id这些信息可能在直播时被跳过了
            // 需要在模型末端进行处理
            if (tc?.name && (!tc?.id || tc.id === "")) {
              logger.debug(
                "[ModelEndHandler] 发现tool_call有姓名但缺少id，将处理：",
                {
                  name: tc.name,
                  id: tc.id,
                },
              );
              return true;
            }
            // 情况三：工具调用已注册但未被调用（dashscope问题）
            // 检查工具是否注册在stepIds中，但invokedToolIds中没有。
            if (
              tc?.id &&
              graph?.toolCallStepIds?.has(tc.id) &&
              graph?.invokedToolIds
            ) {
              if (!graph.invokedToolIds.has(tc.id)) {
                logger.debug(
                  "[ModelEndHandler] 发现tool_call注册但未被调用（dashscope 问题）：",
                  {
                    id: tc.id,
                    name: tc.name,
                    argsLength:
                      typeof tc.args === "string" ? tc.args.length : 0,
                  },
                );
                return true;
              }
            }
            return false;
          });
        } catch (err) {
          logger.debug(
            "[ModelEndHandler] Error checking unprocessed tool calls:",
            err,
          );
          hasUnprocessedToolCalls = false;
        }
      }

      // 处理 Google 工具调用、禁用流媒体，或如果有未处理的工具调用
      // 这处理了 dashscope（使用 OpenAI 兼容 API）工具调用问题
      if (isGoogle || streamingDisabled || hasUnprocessedToolCalls) {
        if (hasUnprocessedToolCalls) {
          logger.info("[ModelEndHandler] Processing unprocessed tool_calls:", {
            count: toolCalls?.length,
            provider: agentContext.provider,
            toolNames: toolCalls
              ?.map((tc) => tc.name || tc.function?.name)
              .filter(Boolean),
          });
        }
        await handleToolCalls(toolCalls, metadata, graph);
      }

      const usage = data?.output?.usage_metadata;
      if (!usage) {
        return this.finalize(errorMessage);
      }
      const modelName =
        metadata?.ls_model_name || agentContext.clientOptions?.model;
      if (modelName) {
        usage.model = modelName;
      }

      this.collectedUsage.push(usage);
      if (!streamingDisabled) {
        return this.finalize(errorMessage);
      }
      if (!data.output.content) {
        return this.finalize(errorMessage);
      }
      const stepKey = graph.getStepKey(metadata);
      const message_id = getMessageId(stepKey, graph) ?? "";
      if (message_id) {
        await graph.dispatchRunStep(stepKey, {
          type: StepTypes.MESSAGE_CREATION,
          message_creation: {
            message_id,
          },
        });
      }
      const stepId = graph.getStepIdByKey(stepKey);
      const content = data.output.content;
      if (typeof content === "string") {
        await graph.dispatchMessageDelta(stepId, {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        });
      } else if (content.every((c) => c.type?.startsWith("text"))) {
        await graph.dispatchMessageDelta(stepId, {
          content,
        });
      }
    } catch (error) {
      logger.error("Error handling model end event:", error);
      return this.finalize(errorMessage);
    }
  }
}

/**
 * @deprecated Agent Chain helper
 * @param {string | undefined} [last_agent_id]
 * @param {string | undefined} [langgraph_node]
 * @returns {boolean}
 */
function checkIfLastAgent(last_agent_id, langgraph_node) {
  if (!last_agent_id || !langgraph_node) {
    return false;
  }
  return langgraph_node?.endsWith(last_agent_id);
}

/**
 * Get default handlers for stream events.
 * @param {Object} options - The options object.
 * @param {ServerResponse} options.res - The options object.
 * @param {ContentAggregator} options.aggregateContent - The options object.
 * @param {ToolEndCallback} options.toolEndCallback - Callback to use when tool ends.
 * @param {Array<UsageMetadata>} options.collectedUsage - The list of collected usage metadata.
 * @returns {Record<string, t.EventHandler>} The default handlers.
 * @throws {Error} If the request is not found.
 */
function getDefaultHandlers({
  res,
  aggregateContent,
  toolEndCallback,
  collectedUsage,
}) {
  if (!res || !aggregateContent) {
    throw new Error(
      `[getDefaultHandlers] Missing required options: res: ${!res}, aggregateContent: ${!aggregateContent}`,
    );
  }
  const handlers = {
    [GraphEvents.CHAT_MODEL_END]: new ModelEndHandler(collectedUsage),
    [GraphEvents.TOOL_END]: new ToolEndHandler(toolEndCallback, logger),
    [GraphEvents.CHAT_MODEL_STREAM]: new ChatModelStreamHandler(),
    [GraphEvents.ON_RUN_STEP]: {
      /**
       * Handle ON_RUN_STEP event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: (event, data, metadata) => {
        if (data?.stepDetails.type === StepTypes.TOOL_CALLS) {
          sendEvent(res, { event, data });
        } else if (
          checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)
        ) {
          sendEvent(res, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          sendEvent(res, { event, data });
        } else {
          const agentName = metadata?.name ?? "Agent";
          const isToolCall = data?.stepDetails.type === StepTypes.TOOL_CALLS;
          const action = isToolCall ? "performing a task..." : "thinking...";
          sendEvent(res, {
            event: "on_agent_update",
            data: {
              runId: metadata?.run_id,
              message: `${agentName} is ${action}`,
            },
          });
        }
        aggregateContent({ event, data });
      },
    },
    [GraphEvents.ON_RUN_STEP_DELTA]: {
      /**
       * Handle ON_RUN_STEP_DELTA event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: (event, data, metadata) => {
        // Filter out tool_call_chunks with null args (LangChain sends this as final chunk)
        // This prevents null from overwriting accumulated tool call arguments
        if (
          data?.delta.type === StepTypes.TOOL_CALLS &&
          data?.delta.tool_calls
        ) {
          const filteredToolCalls = data.delta.tool_calls.filter((tc) => {
            // Keep chunks that have non-null args, or chunks with other meaningful data
            return tc.args !== null || tc.name != null || tc.id != null;
          });

          // Only send event if there are valid tool calls after filtering
          if (filteredToolCalls.length > 0) {
            const filteredData = {
              ...data,
              delta: {
                ...data.delta,
                tool_calls: filteredToolCalls,
              },
            };
            sendEvent(res, { event, data: filteredData });
          }
          // Still aggregate the original data for internal processing
          aggregateContent({ event, data });
        } else if (
          checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)
        ) {
          sendEvent(res, { event, data });
          aggregateContent({ event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          sendEvent(res, { event, data });
          aggregateContent({ event, data });
        } else {
          aggregateContent({ event, data });
        }
      },
    },
    [GraphEvents.ON_RUN_STEP_COMPLETED]: {
      /**
       * Handle ON_RUN_STEP_COMPLETED event.
       * @param {string} event - The event name.
       * @param {StreamEventData & { result: ToolEndData }} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: (event, data, metadata) => {
        if (data?.result != null) {
          sendEvent(res, { event, data });
        } else if (
          checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)
        ) {
          sendEvent(res, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          sendEvent(res, { event, data });
        }
        aggregateContent({ event, data });
      },
    },
    [GraphEvents.ON_MESSAGE_DELTA]: {
      /**
       * Handle ON_MESSAGE_DELTA event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: (event, data, metadata) => {
        if (
          checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)
        ) {
          sendEvent(res, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          sendEvent(res, { event, data });
        }
        aggregateContent({ event, data });
      },
    },
    [GraphEvents.ON_REASONING_DELTA]: {
      /**
       * Handle ON_REASONING_DELTA event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: (event, data, metadata) => {
        if (
          checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)
        ) {
          sendEvent(res, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          sendEvent(res, { event, data });
        }
        aggregateContent({ event, data });
      },
    },
  };

  return handlers;
}

/**
 *
 * @param {Object} params
 * @param {ServerRequest} params.req
 * @param {ServerResponse} params.res
 * @param {Promise<MongoFile | { filename: string; filepath: string; expires: number;} | null>[]} params.artifactPromises
 * @returns {ToolEndCallback} The tool end callback.
 */
function createToolEndCallback({ req, res, artifactPromises }) {
  /**
   * @type {ToolEndCallback}
   */
  return async (data, metadata) => {
    const output = data?.output;
    if (!output) {
      return;
    }

    if (!output.artifact) {
      return;
    }

    if (output.artifact[Tools.file_search]) {
      artifactPromises.push(
        (async () => {
          const user = req.user;
          const attachment = await processFileCitations({
            user,
            metadata,
            appConfig: req.config,
            toolArtifact: output.artifact,
            toolCallId: output.tool_call_id,
          });
          if (!attachment) {
            return null;
          }
          if (!res.headersSent) {
            return attachment;
          }
          res.write(
            `event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`,
          );
          return attachment;
        })().catch((error) => {
          logger.error("Error processing file citations:", error);
          return null;
        }),
      );
    }

    // TODO: a lot of duplicated code in createToolEndCallback
    // we should refactor this to use a helper function in a follow-up PR
    if (output.artifact[Tools.ui_resources]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.ui_resources,
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            [Tools.ui_resources]: output.artifact[Tools.ui_resources].data,
          };
          if (!res.headersSent) {
            return attachment;
          }
          res.write(
            `event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`,
          );
          return attachment;
        })().catch((error) => {
          logger.error("Error processing artifact content:", error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.web_search]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.web_search,
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            [Tools.web_search]: { ...output.artifact[Tools.web_search] },
          };
          if (!res.headersSent) {
            return attachment;
          }
          res.write(
            `event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`,
          );
          return attachment;
        })().catch((error) => {
          logger.error("Error processing artifact content:", error);
          return null;
        }),
      );
    }

    if (output.artifact.content) {
      /** @type {FormattedContent[]} */
      const content = output.artifact.content;
      for (let i = 0; i < content.length; i++) {
        const part = content[i];
        if (!part) {
          continue;
        }
        if (part.type !== "image_url") {
          continue;
        }
        const { url } = part.image_url;
        artifactPromises.push(
          (async () => {
            const filename = `${output.name}_${output.tool_call_id}_img_${nanoid()}`;
            const file_id = output.artifact.file_ids?.[i];
            const file = await saveBase64Image(url, {
              req,
              file_id,
              filename,
              endpoint: metadata.provider,
              context: FileContext.image_generation,
            });
            const fileMetadata = Object.assign(file, {
              messageId: metadata.run_id,
              toolCallId: output.tool_call_id,
              conversationId: metadata.thread_id,
            });
            if (!res.headersSent) {
              return fileMetadata;
            }

            if (!fileMetadata) {
              return null;
            }

            res.write(
              `event: attachment\ndata: ${JSON.stringify(fileMetadata)}\n\n`,
            );
            return fileMetadata;
          })().catch((error) => {
            logger.error("Error processing artifact content:", error);
            return null;
          }),
        );
      }
      return;
    }

    {
      if (output.name !== Tools.execute_code) {
        return;
      }
    }

    if (!output.artifact.files) {
      return;
    }

    for (const file of output.artifact.files) {
      const { id, name } = file;
      artifactPromises.push(
        (async () => {
          const result = await loadAuthValues({
            userId: req.user.id,
            authFields: [EnvVar.CODE_API_KEY],
          });
          const fileMetadata = await processCodeOutput({
            req,
            id,
            name,
            apiKey: result[EnvVar.CODE_API_KEY],
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            session_id: output.artifact.session_id,
          });
          if (!res.headersSent) {
            return fileMetadata;
          }

          if (!fileMetadata) {
            return null;
          }

          res.write(
            `event: attachment\ndata: ${JSON.stringify(fileMetadata)}\n\n`,
          );
          return fileMetadata;
        })().catch((error) => {
          logger.error("Error processing code output:", error);
          return null;
        }),
      );
    }
  };
}

module.exports = {
  getDefaultHandlers,
  createToolEndCallback,
};
