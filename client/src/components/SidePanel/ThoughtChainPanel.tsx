import { useEffect, memo, useMemo, useState } from "react";
import { ConfigProvider, Typography, Flex } from "antd";
import type { ThoughtChainItemType } from "@ant-design/x";
import { ThoughtChain, CodeHighlighter } from "@ant-design/x";
import {
  CheckCircleTwoTone,
  LoadingOutlined,
  CloseCircleTwoTone,
  CodeOutlined,
} from "@ant-design/icons";
import {
  actionDelimiter,
  actionDomainSeparator,
  Constants,
} from "@aipyq/data-provider";
import { useChatContext } from "~/Providers";
import type {
  MessageToolCalls,
  ThoughtChainData,
} from "~/utils/parseDatServerResponse";
import { mapAttachments } from "~/utils/map";
import { useLocalize } from "~/hooks";
import MarkdownLite from "~/components/Chat/Messages/Content/MarkdownLite";

const { Text } = Typography;

// 扩展 ThoughtChainItemType 以支持 children
type ExtendedThoughtChainItemType = ThoughtChainItemType & {
  children?: React.ReactNode;
};

interface ThoughtChainPanelProps {
  toolCallsByMessage: MessageToolCalls[];
  shouldRender: boolean;
  onRenderChange: (shouldRender: boolean) => void;
}

/**
 * SQL 执行结果组件
 */
function SqlExecuteResult({ content }: { content: string }) {
  const formattedContent = useMemo(() => {
    try {
      let toParse = content.trim();
      if (toParse.startsWith('"') && toParse.endsWith('"')) {
        try {
          const unquoted = JSON.parse(toParse);
          if (typeof unquoted === "string") {
            toParse = unquoted;
          } else {
            return JSON.stringify(unquoted, null, 2);
          }
        } catch {
          // ignore
        }
      }
      const parsed = JSON.parse(toParse);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }, [content]);

  return (
    <StyledCodeHighlighter lang="json">
      {formattedContent}
    </StyledCodeHighlighter>
  );
}

/**
 * 代码块组件 - 用于展示工具调用的参数和输出
 * 修复溢出问题，确保内容在容器内正确显示
 */
function OptimizedCodeBlock({
  text,
  maxHeight = 200,
}: {
  text: string;
  maxHeight?: number;
}) {
  const formatText = (str: string) => {
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  };

  return (
    <div
      className="mt-1 w-full overflow-hidden rounded-md bg-surface-tertiary"
      style={{ maxWidth: "100%" }}
    >
      <div
        className="overflow-auto p-2 text-xs text-text-primary"
        style={{ maxHeight, maxWidth: "100%" }}
      >
        <pre
          className="m-0 whitespace-pre-wrap"
          style={{
            wordBreak: "break-all",
            overflowWrap: "break-word",
            maxWidth: "100%",
          }}
        >
          <code>{formatText(text)}</code>
        </pre>
      </div>
    </div>
  );
}

/**
 * 包装 CodeHighlighter 以解决主题和溢出问题
 */
function StyledCodeHighlighter({
  lang,
  children,
}: {
  lang: string;
  children: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-md border border-border-light bg-[#1e1e1e] custom-code-highlighter-wrapper"
      style={{ maxWidth: "100%", width: "100%" }}
    >
      <CodeHighlighter
        lang={lang}
        style={{
          backgroundColor: "transparent",
          maxWidth: "100%",
          width: "100%",
          fontSize: "12px",
        }}
      >
        {children}
      </CodeHighlighter>
    </div>
  );
}

/**
 * becauseai-server 思维链内容组件 - 显示推理过程
 * 插入到原有的样式体系中
 */
function DatServerThoughtChainContent({ data }: { data: ThoughtChainData }) {
  const items = useMemo(() => {
    const result: ExtendedThoughtChainItemType[] = [];

    // 1. 意图分类
    if (data.intentClassification) {
      const intent = data.intentClassification;
      result.push({
        key: "intent",
        title: "意图分类",
        // description: intent.intent || '',
        status: "success",
        collapsible: true,
        content: (
          <div className="space-y-2 text-sm">
            {intent.intent && (
              <div>
                <span className="font-medium text-text-primary">意图:</span>{" "}
                <span className="text-text-secondary">{intent.intent}</span>
              </div>
            )}
            {intent.rephrased_question && (
              <div>
                <span className="font-medium text-text-primary">重述问题:</span>{" "}
                <span className="text-text-secondary">
                  {intent.rephrased_question}
                </span>
              </div>
            )}
            {intent.reasoning && (
              <div>
                <span className="font-medium text-text-primary">推理:</span>{" "}
                <span className="text-text-secondary">{intent.reasoning}</span>
              </div>
            )}
          </div>
        ),
      });
    }

    // 2. SQL 生成推理
    if (data.sqlGenerationReasoning) {
      result.push({
        key: "reasoning",
        title: "SQL 生成推理",
        status: "success",
        collapsible: true,
        content: (
          <div
            className="markdown-content-wrapper"
            style={{
              maxWidth: "100%",
              overflowWrap: "break-word",
              wordWrap: "break-word",
              wordBreak: "break-word",
            }}
          >
            <MarkdownLite content={data.sqlGenerationReasoning} />
          </div>
        ),
      });
    }

    // 3. SQL 生成
    if (data.sqlGenerate) {
      result.push({
        key: "generate",
        title: "SQL 生成",
        status: "success",
        collapsible: true,
        content: (
          <StyledCodeHighlighter lang="sql">
            {data.sqlGenerate}
          </StyledCodeHighlighter>
        ),
      });
    }

    // 4. 语义 SQL 转换
    if (data.semanticToSql) {
      const isError =
        typeof data.semanticToSql === "string" &&
        data.semanticToSql.toLowerCase().includes("error");
      result.push({
        key: "semantic",
        title: "语义 SQL 转换",
        status: isError ? "error" : "success",
        collapsible: true,
        content: isError ? (
          <div className="text-sm text-red-500">{data.semanticToSql}</div>
        ) : (
          <StyledCodeHighlighter lang="sql">
            {data.semanticToSql}
          </StyledCodeHighlighter>
        ),
      });
    }

    // 5. SQL 执行结果
    if (data.sqlExecute) {
      result.push({
        key: "execute",
        title: "SQL 执行结果",
        status: "success",
        collapsible: true,
        content: <SqlExecuteResult content={data.sqlExecute} />,
      });
    }

    // 6. 异常信息
    if (data.exception) {
      result.push({
        key: "exception",
        title: "异常信息",
        description: data.exception.message || "",
        status: "error",
      });
    }

    return result;
  }, [data]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 border-t border-border-light pt-2">
      <div className="mb-2 text-xs font-medium text-text-secondary">
        推理过程
      </div>
      <ThoughtChain items={items} defaultExpandedKeys={[]} />
    </div>
  );
}

/**
 * 工具调用详情内容组件 - 用于在可折叠区域内展示
 */
function ToolCallDetailContent({
  args,
  output,
  domain,
  function_name,
  localize,
  thoughtChain,
}: {
  args: string;
  output?: string | null;
  domain: string | null;
  function_name: string;
  localize: any;
  thoughtChain: ThoughtChainData | null;
}) {
  const hasOutput = output != null && output.length > 0;

  return (
    <div
      className="w-full space-y-3 overflow-hidden"
      style={{ maxWidth: "100%" }}
    >
      {/* 参数 */}
      {args && (
        <div className="w-full overflow-hidden" style={{ maxWidth: "100%" }}>
          <Text type="secondary" className="mb-1 block text-xs">
            {domain
              ? localize("com_assistants_domain_info", { 0: domain })
              : localize("com_assistants_function_use", { 0: function_name })}
          </Text>
          <OptimizedCodeBlock text={args} />
        </div>
      )}

      {/* 输出结果 */}
      {hasOutput && (
        <div className="w-full overflow-hidden" style={{ maxWidth: "100%" }}>
          <Text type="secondary" className="mb-1 block text-xs">
            {localize("com_ui_result")}
          </Text>
          <OptimizedCodeBlock text={output!} />
        </div>
      )}

      {/* becauseai-server 思维链内容 - 新增 */}
      {thoughtChain && <DatServerThoughtChainContent data={thoughtChain} />}
    </div>
  );
}

/**
 * 单个工具调用项 - 使用 ant-design-x ThoughtChain 组件
 * 支持折叠功能，保持实时数据更新能力
 */
function SidePanelToolCallItem({
  toolCall,
  thoughtChain,
  isSubmitting,
  itemKey,
}: {
  toolCall: {
    name: string;
    args: string | Record<string, unknown>;
    output?: string | null;
    progress?: number;
    id?: string;
    auth?: string;
    expires_at?: number;
  };
  thoughtChain: ThoughtChainData | null;
  attachments?: any[];
  isSubmitting: boolean;
  itemKey: string;
}) {
  const localize = useLocalize();

  // 解析工具名称和域名 - 与原生 ToolCall 逻辑一致
  const { function_name, domain, isMCPToolCall } = useMemo(() => {
    const name = toolCall.name;
    if (typeof name !== "string") {
      return { function_name: "", domain: null, isMCPToolCall: false };
    }
    if (name.includes(Constants.mcp_delimiter)) {
      const [func, server] = name.split(Constants.mcp_delimiter);
      return {
        function_name: func || "",
        domain:
          server && (server.replaceAll(actionDomainSeparator, ".") || null),
        isMCPToolCall: true,
      };
    }
    const [func, _domain] = name.includes(actionDelimiter)
      ? name.split(actionDelimiter)
      : [name, ""];
    return {
      function_name: func || "",
      domain:
        _domain && (_domain.replaceAll(actionDomainSeparator, ".") || null),
      isMCPToolCall: false,
    };
  }, [toolCall.name]);

  // 格式化参数
  const args = useMemo(() => {
    if (typeof toolCall.args === "string") {
      return toolCall.args;
    }
    try {
      return JSON.stringify(toolCall.args, null, 2);
    } catch {
      return "";
    }
  }, [toolCall.args]);

  // 状态计算
  const hasOutput = toolCall.output != null && toolCall.output.length > 0;
  const error =
    typeof toolCall.output === "string" &&
    toolCall.output.toLowerCase().includes("error processing tool");
  const isLoading = !hasOutput && isSubmitting;
  const cancelled = !isSubmitting && !hasOutput && !error;

  // 获取状态 - ThoughtChain 支持 'success' | 'error' | 'loading' 等
  const getStatus = (): "success" | "error" | "loading" => {
    if (error) return "error";
    if (cancelled) return "error";
    if (hasOutput) return "success";
    return "loading";
  };

  // 获取图标 - 使用 TwoTone 图标组件，支持 twoToneColor 属性设置颜色
  const getIcon = () => {
    if (isLoading) return <LoadingOutlined spin />;
    if (error || cancelled) {
      return <CloseCircleTwoTone twoToneColor="#ef4444" />;
    }
    if (hasOutput) {
      return <CheckCircleTwoTone twoToneColor="#10b981" />;
    }
    return <CodeOutlined />;
  };

  // 获取标题文本
  const getTitle = () => {
    if (isLoading) {
      return function_name
        ? localize("com_assistants_running_var", { 0: function_name })
        : localize("com_assistants_running_action");
    }
    if (cancelled) {
      return localize("com_ui_cancelled");
    }
    if (isMCPToolCall) {
      return localize("com_assistants_completed_function", {
        0: function_name,
      });
    }
    if (domain && domain.length !== Constants.ENCODED_DOMAIN_LENGTH) {
      return localize("com_assistants_completed_action", { 0: domain });
    }
    return localize("com_assistants_completed_function", { 0: function_name });
  };

  // 是否有详情内容
  const hasDetails = args || hasOutput || thoughtChain;

  // 构建 ThoughtChain 项目 - 显式指定类型避免类型错误
  const status = getStatus();
  // 如果没有 domain，就不要在 description 再重复 function_name，避免出现
  //「运行 because」下一行又单独显示「because」的重复效果
  const description =
    domain && domain.length !== Constants.ENCODED_DOMAIN_LENGTH ? domain : "";

  const toolCallItems: ExtendedThoughtChainItemType[] = [
    {
      key: itemKey,
      title: getTitle(),
      // description,
      icon: getIcon(),
      status,
      collapsible: !!hasDetails,
      content: hasDetails ? (
        <ToolCallDetailContent
          args={args}
          output={toolCall.output}
          domain={domain}
          function_name={function_name}
          localize={localize}
          thoughtChain={thoughtChain}
        />
      ) : undefined,
    },
  ];

  // 移除内部额外的 ThoughtChain 包装，防止多重缩进导致的溢出
  // return (
  //     <div className="w-full overflow-hidden" style={{ maxWidth: '100%' }}>
  //         <ThoughtChain items={toolCallItems} />
  //     </div>
  // );

  // 直接返回 ThoughtChain，但实际上 SidePanelToolCallItem 本身是被父级 ThoughtChain 调用的
  // 问题在于：父级 ThoughtChain (Round) -> SidePanelToolCallItem -> ThoughtChain (ToolCall) -> DatServerThoughtChainContent -> ThoughtChain (Steps)
  // 这是三层嵌套。
  // 为了减少缩进，我们可以手动渲染折叠效果，但这比较复杂。
  // 另一种方法是使用更紧凑的样式。
  // 但用户说"它有个缩进的样式，可能是这个问题导致的"，所以减少层级是关键。

  // 尝试方案：保持 ThoughtChain 但强制修改其样式以减少缩进
  return (
    <div className="w-full overflow-hidden" style={{ maxWidth: "100%" }}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
                /* 针对特定层级减少缩进 */
                .nested-chain .ant-thought-chain-item-content {
                    padding-left: 0 !important;
                    margin-left: 0 !important;
                }
             `,
        }}
      />
      <ThoughtChain className="nested-chain" items={toolCallItems} />
    </div>
  );
}

/**
 * ThoughtChainPanel 组件 - 使用 ant-design-x ThoughtChain 组件展示思维链
 * 直接引用原生 ToolCall 组件实现实时展示
 */
const ThoughtChainPanel = memo(function ThoughtChainPanel({
  toolCallsByMessage,
  shouldRender,
  onRenderChange,
}: ThoughtChainPanelProps) {
  const { getMessages, isSubmitting } = useChatContext();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // 获取所有消息的附件
  const attachmentsMap = useMemo(() => {
    const messages = getMessages();
    if (!messages || messages.length === 0) {
      return {};
    }

    const allAttachments: any[] = [];
    messages.forEach((message: any) => {
      if (message.attachments && Array.isArray(message.attachments)) {
        allAttachments.push(...message.attachments);
      }
    });

    return mapAttachments(allAttachments);
  }, [getMessages]);

  // 通知父组件是否有数据需要渲染
  useEffect(() => {
    if (toolCallsByMessage.length > 0) {
      onRenderChange(true);
    }
  }, [toolCallsByMessage, onRenderChange]);

  // 自动展开最新的轮次
  useEffect(() => {
    if (toolCallsByMessage.length > 0) {
      const latestKey = `round-${toolCallsByMessage.length - 1}`;
      setExpandedKeys((prev) => {
        if (!prev.includes(latestKey)) {
          return [...prev, latestKey];
        }
        return prev;
      });
    }
  }, [toolCallsByMessage.length]);

  if (!shouldRender) {
    return null;
  }

  if (toolCallsByMessage.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-sm">暂无思维链数据</p>
        </div>
      </div>
    );
  }

  // 构建 ThoughtChain 项目 - 按对话轮次分组
  const chainItems: ExtendedThoughtChainItemType[] = toolCallsByMessage
    .filter(
      (messageData) =>
        messageData.toolCalls && messageData.toolCalls.length > 0,
    )
    .map((messageData, roundIdx) => {
      const roundKey = `round-${roundIdx}`;
      // 使用 extractedToolCalls 直接获取工具调用
      const toolCount = messageData.toolCalls.length;
      const isStreaming = messageData.isStreaming;

      const hasAnyLoading = messageData.toolCalls.some(
        (tc) => tc.toolCall.output == null || tc.toolCall.output.length === 0,
      );

      // 构建描述文本
      const descriptionParts: string[] = [];
      if (toolCount > 0) {
        descriptionParts.push(`${toolCount} 个工具调用`);
      }

      const description = descriptionParts.join("，") || "无内容";

      // 渲染内容：遍历 toolCalls
      const renderContentItems = () => {
        if (!messageData.toolCalls || messageData.toolCalls.length === 0) {
          return null;
        }

        return (
          <Flex gap="small" vertical style={{ width: "100%" }}>
            {messageData.toolCalls.map((item, itemIdx) => {
              const tcKey = `${roundKey}-tc-${itemIdx}`;
              const tcAttachments = item.toolCall.id
                ? attachmentsMap[item.toolCall.id]
                : undefined;

              return (
                <SidePanelToolCallItem
                  key={tcKey}
                  itemKey={tcKey}
                  toolCall={item.toolCall}
                  thoughtChain={item.thoughtChain} // 传递思维链数据
                  attachments={tcAttachments}
                  isSubmitting={isSubmitting}
                />
              );
            })}
          </Flex>
        );
      };

      return {
        key: roundKey,
        title: `第 ${messageData.messageIndex} 轮对话`,
        description,
        status: isStreaming || hasAnyLoading ? "loading" : "success",
        collapsible: true,
        content: renderContentItems(),
      };
    });

  return (
    <ConfigProvider
      theme={
        {
          token: {
            colorBgContainer: "var(--bg-surface-secondary)",
            colorText: "var(--text-primary)",
            colorBorder: "var(--border-light)",
            colorTextDescription: "var(--text-secondary)",
          },
          components: {
            // ThoughtChain 是 @ant-design/x 的组件，这里通过 any 绕过 antd 类型检查
            ...({
              ThoughtChain: {
                titleColor: "var(--text-primary)",
                descriptionColor: "var(--text-secondary)",
                itemBg: "transparent",
                itemHoverBg: "var(--surface-hover)",
                // 状态颜色配置
                successColor: "#10b981", // 绿色
                errorColor: "#ef4444", // 红色
                loadingColor: "var(--text-secondary)", // 加载中颜色
              },
            } as any),
          },
        } as any
      }
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* 标题 */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border-light bg-background px-4 py-3">
          <div className="text-base font-semibold text-text-primary">
            思维链
          </div>
          <div className="text-xs text-text-secondary">
            共 {toolCallsByMessage.length} 轮
          </div>
        </div>

        {/* 思维链内容 */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 thought-chain-container text-sm"
          style={
            {
              color: "var(--text-tertiary)",
            } as React.CSSProperties
          }
        >
          <style
            dangerouslySetInnerHTML={{
              __html: `
            /* 基础文字颜色：使用次级文字色，降低对比度 */
            .thought-chain-container,
            .thought-chain-container *,
            .thought-chain-container *::before,
            .thought-chain-container *::after {
              color: var(--text-tertiary) !important;
            }
            /* 标题元素使用主文字色，保证层级感 */
            .thought-chain-container [class*="title"],
            .thought-chain-container [class*="Title"],
            .thought-chain-container [class*="title"] *,
            .thought-chain-container [class*="Title"] *,
            .thought-chain-container button span:first-child,
            .thought-chain-container div[role="button"] span:first-child,
            .thought-chain-container button > span:first-of-type,
            .thought-chain-container div[role="button"] > span:first-of-type {
              color: var(--text-primary) !important;
            }
            /* 描述、副文本维持为次级文字色 */
            .thought-chain-container [class*="description"],
            .thought-chain-container [class*="Description"],
            .thought-chain-container [class*="description"] *,
            .thought-chain-container [class*="Description"] *,
            .thought-chain-container button span:last-child,
            .thought-chain-container div[role="button"] span:last-child,
            .thought-chain-container button > span:last-of-type,
            .thought-chain-container div[role="button"] > span:last-of-type {
              color: var(--text-tertiary) !important;
            }
            /* 覆盖内联颜色为三级文字色，进一步降低对比 */
            .thought-chain-container [style*="color"] {
              color: var(--text-tertiary) !important;
            }
            .thought-chain-container [style*="color"] [class*="description"],
            .thought-chain-container [style*="color"] [class*="Description"] {
              color: var(--text-tertiary) !important;
            }
            /* 工具调用图标颜色 - 根据状态设置 */
            .thought-chain-container [class*="anticon"][style*="color: rgb(239, 68, 68)"],
            .thought-chain-container [class*="anticon"][style*="color:#ef4444"],
            .thought-chain-container [class*="anticon"][style*="color: #ef4444"] {
              color: #ef4444 !important;
            }
            .thought-chain-container [class*="anticon"][style*="color: rgb(16, 185, 129)"],
            .thought-chain-container [class*="anticon"][style*="color:#10b981"],
            .thought-chain-container [class*="anticon"][style*="color: #10b981"] {
              color: #10b981 !important;
            }
            /* 通过 data-tool-call-status 属性设置图标颜色 - 使用更高优先级 */
            .thought-chain-container [data-tool-call-status="error"] [class*="anticon"],
            .thought-chain-container [data-tool-call-status="error"] [class*="anticon"] svg,
            .thought-chain-container [data-tool-call-status="error"] [class*="anticon"] path,
            .thought-chain-container [data-tool-call-status="error"] svg,
            .thought-chain-container [data-tool-call-status="error"] svg path,
            .thought-chain-container [data-tool-call-status="error"] path {
              color: #ef4444 !important;
              fill: #ef4444 !important;
              stroke: #ef4444 !important;
            }
            .thought-chain-container [data-tool-call-status="success"] [class*="anticon"],
            .thought-chain-container [data-tool-call-status="success"] [class*="anticon"] svg,
            .thought-chain-container [data-tool-call-status="success"] [class*="anticon"] path,
            .thought-chain-container [data-tool-call-status="success"] svg,
            .thought-chain-container [data-tool-call-status="success"] svg path,
            .thought-chain-container [data-tool-call-status="success"] path {
              color: #10b981 !important;
              fill: #10b981 !important;
              stroke: #10b981 !important;
            }
            /* 直接针对 Ant Design 图标类名和 SVG 元素 */
            .thought-chain-container .tool-call-icon-error [class*="anticon"],
            .thought-chain-container .tool-call-icon-error [class*="anticon"] svg,
            .thought-chain-container .tool-call-icon-error [class*="anticon"] svg path,
            .thought-chain-container .tool-call-icon-error svg,
            .thought-chain-container .tool-call-icon-error svg path,
            .thought-chain-container .tool-call-icon-error path {
              color: #ef4444 !important;
              fill: #ef4444 !important;
              stroke: #ef4444 !important;
            }
            .thought-chain-container .tool-call-icon-success [class*="anticon"],
            .thought-chain-container .tool-call-icon-success [class*="anticon"] svg,
            .thought-chain-container .tool-call-icon-success [class*="anticon"] svg path,
            .thought-chain-container .tool-call-icon-success svg,
            .thought-chain-container .tool-call-icon-success svg path,
            .thought-chain-container .tool-call-icon-success path {
              color: #10b981 !important;
              fill: #10b981 !important;
              stroke: #10b981 !important;
            }
            /* 针对 Ant Design 图标的具体类名 */
            .thought-chain-container .anticon-close-circle svg,
            .thought-chain-container .anticon-close-circle svg path {
              fill: #ef4444 !important;
              color: #ef4444 !important;
            }
            .thought-chain-container .anticon-check-circle svg,
            .thought-chain-container .anticon-check-circle svg path {
              fill: #10b981 !important;
              color: #10b981 !important;
            }
            
            /* CodeHighlighter 样式修正 */
            .thought-chain-container .ant-code-highlighter {
               background: rgba(30, 30, 30, 0.5) !important;
               border-radius: 6px;
            }
            
            /* 强制覆盖代码块颜色 */
            .thought-chain-container pre, 
            .thought-chain-container code {
              background: transparent !important;
              font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
              overflow-wrap: break-word !important;
              max-width: 100% !important;
            }
            
            /* 针对 ant-code-highlighter 内部所有的元素强制换行 */
            .thought-chain-container .ant-code-highlighter *,
            .thought-chain-container .ant-code-highlighter span,
            .thought-chain-container .ant-code-highlighter div {
               white-space: pre-wrap !important;
               word-break: break-all !important;
               overflow-wrap: break-word !important;
            }

            /* 针对 custom-code-highlighter-wrapper 内部所有的元素强制换行 - 终极方案 */
            .custom-code-highlighter-wrapper pre,
            .custom-code-highlighter-wrapper code,
            .custom-code-highlighter-wrapper span,
            .custom-code-highlighter-wrapper div {
               white-space: pre-wrap !important;
               word-break: break-all !important;
               overflow-wrap: anywhere !important; /*比 break-word 更强*/
               max-width: 100% !important;
               box-sizing: border-box !important;
            }
            
            /* 如果 CodeHighlighter 使用了 table 布局 (针对行号) */
            .custom-code-highlighter-wrapper table {
                table-layout: fixed !important;
                width: 100% !important;
            }
            .custom-code-highlighter-wrapper td {
                white-space: pre-wrap !important;
                word-break: break-all !important;
                overflow-wrap: anywhere !important;
            }

            /* Markdown 内容强制换行 */
            .thought-chain-container .markdown-content-wrapper,
            .thought-chain-container .markdown-content-wrapper p,
            .thought-chain-container .markdown-content-wrapper li,
            .thought-chain-container .markdown-content-wrapper span {
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
              overflow-wrap: break-word !important;
              max-width: 100% !important;
            }
           `,
            }}
          />
          <ThoughtChain
            items={chainItems}
            expandedKeys={expandedKeys}
            onExpand={setExpandedKeys}
          />
        </div>
      </div>
    </ConfigProvider>
  );
});

ThoughtChainPanel.displayName = "ThoughtChainPanel";

export default ThoughtChainPanel;
