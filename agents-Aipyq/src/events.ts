/* eslint-disable no-console */
// src/events.ts
import type {
  ToolMessage,
  UsageMetadata,
  BaseMessageFields,
} from '@langchain/core/messages';
import type { MultiAgentGraph, StandardGraph } from '@/graphs';
import type { Logger } from 'winston';
import type * as t from '@/types';
import { handleToolCalls } from '@/tools/handlers';
import { Constants, Providers } from '@/common';

export class HandlerRegistry {
  private handlers: Map<string, t.EventHandler> = new Map();

  register(eventType: string, handler: t.EventHandler): void {
    this.handlers.set(eventType, handler);
  }

  getHandler(eventType: string): t.EventHandler | undefined {
    return this.handlers.get(eventType);
  }
}

export class ModelEndHandler implements t.EventHandler {
  collectedUsage?: UsageMetadata[];
  constructor(collectedUsage?: UsageMetadata[]) {
    if (collectedUsage && !Array.isArray(collectedUsage)) {
      throw new Error('collectedUsage must be an array');
    }
    this.collectedUsage = collectedUsage;
  }

  async handle(
    event: string,
    data: t.ModelEndData,
    metadata?: Record<string, unknown>,
    graph?: StandardGraph | MultiAgentGraph
  ): Promise<void> {
    if (!graph || !metadata) {
      console.warn(`Graph or metadata not found in ${event} event`);
      return;
    }

    const usage = data?.output?.usage_metadata;
    if (usage != null && this.collectedUsage != null) {
      this.collectedUsage.push(usage);
    }

    if (metadata.ls_provider === 'FakeListChatModel') {
      return handleToolCalls(data?.output?.tool_calls, metadata, graph);
    }

    // 检查additional_kwargs中的工具调用（dashscope/OpenAI 兼容 API）
    const additionalKwargsToolCalls = data?.output?.additional_kwargs.tool_calls as Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }> | undefined;

    const agentContext = graph.getAgentContext(metadata);

    // 从标准位置获取工具调用，或从additional_kwargs转换
    let toolCalls = data?.output?.tool_calls;

    // 如果没有标准tool_calls但有 additional_kwargs.tool_calls，就转换它们
    // 这处理了 DashScope/OpenAI 兼容的 API，tool_calls 可能additional_kwargs
    if ((!toolCalls || toolCalls.length === 0) && additionalKwargsToolCalls?.length) {
      toolCalls = additionalKwargsToolCalls
        .filter(tc => {
          // 过滤掉无效的工具调用（无名称且无参数）
          const hasName = tc.function?.name && tc.function.name.length > 0;
          const hasArgs = tc.function?.arguments && tc.function.arguments.length > 0;
          return hasName || hasArgs;
        })
        .map((tc, index) => {
          // 如果丢失了，试着从保存的信息中恢复姓名/ID。
          const savedInfo = graph.toolCallInfoByIndex.get(index);
          const name = (tc.function?.name && tc.function.name.length > 0)
            ? tc.function.name
            : savedInfo?.name || '';
          const id = (tc.id && tc.id.length > 0)
            ? tc.id
            : savedInfo?.id || `generated_${Date.now()}_${Math.random().toString(36).substring(7)}`;

          let args = {};
          try {
            args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            // 未能解析参数，使用空对象
          }

          return {
            id,
            name,
            args,
            type: 'tool_call' as const,
          };
        });
    }

    // 检查是否有未处理的工具调用
    // 这适用于stream处理tool_calls不正常的情况（例如dashscope）。
    let hasUnprocessedToolCalls = false;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      hasUnprocessedToolCalls = toolCalls.some(
        (tc) => {
          // 情况1：已识别但尚未处理（toolCallStepIds 中未处理）
          if (tc.id && graph.toolCallStepIds.has && !graph.toolCallStepIds.has(tc.id)) {
            return true;
          }
          // 情况二：有名字但没有id可能在stream时被跳过了
          if (tc.name && (!tc.id || tc.id === '')) {
            return true;
          }
          // 情况三：工具调用已注册但未被调用（dashscope问题）
          if (tc.id && graph.toolCallStepIds.has(tc.id) && graph.invokedToolIds) {
            if (!graph.invokedToolIds.has(tc.id)) {
              return true;
            }
          }
          return false;
        },
      );
    }

    // 处理 Google/Bedrock 的工具调用，或者如果有未处理的工具调用
    // 这处理了 dashscope（使用 OpenAI 兼容 API）工具调用问题
    const shouldProcessToolCalls =
      agentContext.provider === Providers.GOOGLE ||
      agentContext.provider === Providers.BEDROCK ||
      hasUnprocessedToolCalls;

    if (shouldProcessToolCalls) {
      await handleToolCalls(toolCalls, metadata, graph);
    }
  }
}

export class ToolEndHandler implements t.EventHandler {
  private callback?: t.ToolEndCallback;
  private logger?: Logger;
  private omitOutput?: (name?: string) => boolean;
  constructor(
    callback?: t.ToolEndCallback,
    logger?: Logger,
    omitOutput?: (name?: string) => boolean
  ) {
    this.callback = callback;
    this.logger = logger;
    this.omitOutput = omitOutput;
  }
  async handle(
    event: string,
    data: t.StreamEventData | undefined,
    metadata?: Record<string, unknown>,
    graph?: StandardGraph | MultiAgentGraph
  ): Promise<void> {
    try {
      if (!graph || !metadata) {
        if (this.logger) {
          this.logger.warn(`Graph or metadata not found in ${event} event`);
        } else {
          console.warn(`Graph or metadata not found in ${event} event`);
        }
        return;
      }

      const toolEndData = data as t.ToolEndData | undefined;
      if (!toolEndData?.output) {
        if (this.logger) {
          this.logger.warn('No output found in tool_end event');
        } else {
          console.warn('No output found in tool_end event');
        }
        return;
      }

      if (metadata[Constants.PROGRAMMATIC_TOOL_CALLING] === true) {
        return;
      }

      if (this.callback) {
        await this.callback(toolEndData, metadata);
      }
      await graph.handleToolCallCompleted(
        { input: toolEndData.input, output: toolEndData.output },
        metadata,
        this.omitOutput?.((toolEndData.output as ToolMessage | undefined)?.name)
      );
    } catch (error) {
      if (this.logger) {
        this.logger.error('Error handling tool_end event:', error);
      } else {
        console.error('Error handling tool_end event:', error);
      }
    }
  }
}

export class TestLLMStreamHandler implements t.EventHandler {
  handle(event: string, data: t.StreamEventData | undefined): void {
    const chunk = data?.chunk;
    const isMessageChunk = !!(chunk && 'message' in chunk);
    const msg = isMessageChunk ? chunk.message : undefined;
    if (msg && msg.tool_call_chunks && msg.tool_call_chunks.length > 0) {
      console.log(msg.tool_call_chunks);
    } else if (msg && msg.content) {
      if (typeof msg.content === 'string') {
        process.stdout.write(msg.content);
      }
    }
  }
}

export class TestChatStreamHandler implements t.EventHandler {
  handle(event: string, data: t.StreamEventData | undefined): void {
    const chunk = data?.chunk;
    const isContentChunk = !!(chunk && 'content' in chunk);
    const content = isContentChunk && chunk.content;

    if (!content || !isContentChunk) {
      return;
    }

    if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
      console.dir(chunk.tool_call_chunks, { depth: null });
    }

    if (typeof content === 'string') {
      process.stdout.write(content);
    } else {
      console.dir(content, { depth: null });
    }
  }
}

export class LLMStreamHandler implements t.EventHandler {
  handle(
    event: string,
    data: t.StreamEventData | undefined,
    metadata?: Record<string, unknown>
  ): void {
    const chunk = data?.chunk;
    const isMessageChunk = !!(chunk && 'message' in chunk);
    const msg = isMessageChunk && chunk.message;
    if (metadata) {
      console.log(metadata);
    }
    if (msg && msg.tool_call_chunks && msg.tool_call_chunks.length > 0) {
      console.log(msg.tool_call_chunks);
    } else if (msg && msg.content) {
      if (typeof msg.content === 'string') {
        // const text_delta = msg.content;
        // dispatchCustomEvent(GraphEvents.CHAT_MODEL_STREAM, { chunk }, config);
        process.stdout.write(msg.content);
      }
    }
  }
}

export const createMetadataAggregator = (
  _collected?: Record<
    string,
    NonNullable<BaseMessageFields['response_metadata']>
  >[]
): t.MetadataAggregatorResult => {
  const collected = _collected || [];

  const handleLLMEnd: t.HandleLLMEnd = (output) => {
    const { generations } = output;
    const lastMessageOutput = (
      generations[generations.length - 1] as
        | (t.StreamGeneration | undefined)[]
        | undefined
    )?.[0];
    if (!lastMessageOutput) {
      return;
    }
    const { message } = lastMessageOutput;
    if (message?.response_metadata) {
      collected.push(message.response_metadata);
    }
  };

  return { handleLLMEnd, collected };
};
