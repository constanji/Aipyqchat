import { Constants, ContentTypes } from "@aipyq/data-provider";

export interface ThoughtChainData {
    intentClassification?: {
        rephrased_question?: string;
        reasoning?: string;
        intent?: string;
    };
    sqlGenerationReasoning?: string;
    sqlGenerate?: string;
    semanticToSql?: string;
    sqlExecute?: string;
    exception?: {
        message?: string;
        [key: string]: unknown;
    };
}

export interface ToolCallInfo {
    name: string;
    args: string | Record<string, unknown>;
    output?: string | null;
    id?: string;
    progress?: number;
    auth?: string;
    expires_at?: number;
}

export interface ToolCallWithThoughtChain {
    thoughtChain: ThoughtChainData | null;
    toolCall: ToolCallInfo;
}

/**
 * 按消息分组的工具调用数据
 * 用于支持多轮对话的思维链展示
 */
export interface MessageToolCalls {
    messageId: string;
    messageIndex: number; // 消息在对话中的序号（从1开始）
    toolCalls: ToolCallWithThoughtChain[];
    isStreaming?: boolean; // 是否正在流式输出
}

// 辅助函数：创建用于匹配各个分区的正则
// 使用 flexible dash count and optional leading/trailing whitespace
function createSectionRegex(sectionName: string): RegExp {
    // 匹配模式：
    // 1. 可选的行首或换行 (?:^|[\r\n]+)
    // 2. 至少 5 个连字符 -{5,}
    // 3. 可能的空白 \s*
    // 4. sectionName
    // 5. 可能的空白 \s*
    // 6. 至少 5 个连字符 -{5,}
    // 7. 捕获内容 ([\s\S]*?)
    // 8. Lookahead: 下一个分区的开始（连字符+单词+连字符） 或者 字符串结束
    return new RegExp(
        `(?:^|[\\r\\n]+)-{5,}\\s*${sectionName}\\s*-{5,}[\\r\\n]+([\\s\\S]*?)(?=(?:[\\r\\n]+-{5,}\\s*[\\w_]+\\s*-{5,})|$)`,
        'i',
    );
}

export function parseDatServerResponse(response: string): ThoughtChainData | null {
    if (!response || typeof response !== 'string') {
        return null;
    }

    // 处理转义的换行符：将 \n 字符串转换为真正的换行符
    // 先尝试直接解析，如果失败则处理转义
    let normalizedResponse = response.trim();

    // 1. 尝试去除首尾引号 (支持流式输出可能缺失尾部引号的情况)
    if (normalizedResponse.startsWith('"')) {
        normalizedResponse = normalizedResponse.substring(1);
    }
    if (normalizedResponse.endsWith('"')) {
        normalizedResponse = normalizedResponse.substring(0, normalizedResponse.length - 1);
    }

    // 2. 处理转义字符
    // 如果包含 \n 字符串但没有真正的换行符，说明是转义的
    // 或者看起来像是 JSON 字符串的内容
    if (normalizedResponse.includes('\\n') || normalizedResponse.includes('\\"')) {
        try {
            // 手动替换以解转义
            normalizedResponse = normalizedResponse
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');

            // 如果处理后还有首尾引号（原本是双重转义的情况），再次去除
            if (normalizedResponse.startsWith('"') && normalizedResponse.endsWith('"')) {
                normalizedResponse = normalizedResponse.substring(1, normalizedResponse.length - 1);
            }
        } catch (e) {
            // ignore
        }
    }

    // 检查是否包含分隔符 (放宽检查条件，只要有连续的 dashes 就可以)
    if (!normalizedResponse.includes('-----')) {
        return null;
    }

    const result: ThoughtChainData = {};

    // 解析 intent_classification
    const intentMatch = normalizedResponse.match(createSectionRegex('intent_classification'));
    if (intentMatch && intentMatch[1]) {
        let intentContent = intentMatch[1].trim();
        if (intentContent && intentContent.length > 0) {
            try {
                // 处理转义的 JSON 字符串
                if (intentContent.startsWith('"') && intentContent.endsWith('"')) {
                    try {
                        intentContent = JSON.parse(intentContent);
                        if (typeof intentContent === 'string') {
                            intentContent = JSON.parse(intentContent);
                        }
                    } catch {
                        //手动处理转义
                        try {
                            intentContent = JSON.parse(
                                intentContent
                                    .slice(1, -1)
                                    .replace(/\\"/g, '"')
                                    .replace(/\\n/g, '\n')
                                    .replace(/\\r/g, '\r')
                                    .replace(/\\\\/g, '\\'),
                            );
                        } catch {
                            // ignore
                        }
                    }
                }

                if (typeof intentContent === 'string') {
                    const intentData = JSON.parse(intentContent);
                    if (intentData && typeof intentData === 'object') {
                        result.intentClassification = intentData;
                    }
                } else if (typeof intentContent === 'object' && intentContent !== null) {
                    result.intentClassification = intentContent;
                }
            } catch (e) {
                // ignore error
            }
        }
    }

    // 解析 sql_generation_reasoning
    const reasoningMatch = normalizedResponse.match(createSectionRegex('sql_generation_reasoning'));
    if (reasoningMatch && reasoningMatch[1]) {
        const reasoningContent = reasoningMatch[1].trim();
        if (reasoningContent && reasoningContent.length > 0) {
            result.sqlGenerationReasoning = reasoningContent;
        }
    }

    // 解析 sql_generate
    const sqlMatch = normalizedResponse.match(createSectionRegex('sql_generate'));
    if (sqlMatch && sqlMatch[1]) {
        const sqlContent = sqlMatch[1].trim();
        if (sqlContent && sqlContent.length > 0) {
            result.sqlGenerate = sqlContent.replace(/^Semantic SQL:\s*/i, '');
        }
    }

    // 解析 semantic_to_sql
    const semanticMatch = normalizedResponse.match(createSectionRegex('semantic_to_sql'));
    if (semanticMatch && semanticMatch[1]) {
        let semanticContent = semanticMatch[1].trim();
        if (semanticContent && semanticContent.length > 0) {
            // 处理转义 JSON
            if (semanticContent.startsWith('"') && semanticContent.endsWith('"')) {
                try {
                    semanticContent = JSON.parse(semanticContent);
                    if (typeof semanticContent !== 'string') {
                        semanticContent = JSON.stringify(semanticContent);
                    }
                } catch {
                    // ignore
                }
            }

            try {
                const semanticData = JSON.parse(semanticContent);
                if (semanticData && typeof semanticData === 'object' && semanticData.error) {
                    result.semanticToSql = `错误: ${semanticData.error}`;
                } else {
                    result.semanticToSql =
                        semanticData.QuerySQL || semanticData.query_sql || semanticContent;
                }
            } catch (e) {
                if (semanticContent.startsWith('Query SQL:')) {
                    result.semanticToSql = semanticContent.replace(/^Query SQL:\s*/i, '');
                } else {
                    result.semanticToSql = semanticContent;
                }
            }
        }
    }

    // 解析 sql_execute
    const sqlExecuteMatch = normalizedResponse.match(createSectionRegex('sql_execute'));
    if (sqlExecuteMatch && sqlExecuteMatch[1]) {
        let executeContent = sqlExecuteMatch[1].trim();
        if (executeContent && executeContent.length > 0) {
            executeContent = executeContent.replace(/^Query Results:\s*/i, '').trim();
            result.sqlExecute = executeContent;
        }
    }

    // 解析 exception
    const exceptionMatch = normalizedResponse.match(createSectionRegex('exception'));
    if (exceptionMatch && exceptionMatch[1]) {
        let exceptionContent = exceptionMatch[1].trim();
        if (exceptionContent && exceptionContent.length > 0) {
            try {
                if (exceptionContent.startsWith('"') && exceptionContent.endsWith('"')) {
                    try {
                        exceptionContent = JSON.parse(exceptionContent);
                        if (typeof exceptionContent !== 'string') {
                            exceptionContent = JSON.stringify(exceptionContent);
                        }
                    } catch {
                        // ignore
                    }
                }

                const exceptionData = JSON.parse(exceptionContent);
                if (exceptionData && typeof exceptionData === 'object') {
                    result.exception = exceptionData;
                }
            } catch (e) {
                // ignore
            }
        }
    }

    if (
        !result.intentClassification &&
        !result.sqlGenerationReasoning &&
        !result.sqlGenerate &&
        !result.semanticToSql &&
        !result.sqlExecute &&
        !result.exception
    ) {
        return null;
    }

    return result;
}

/**
 * 从消息中提取所有 becauseai-server 工具调用的思维链数据
 * 返回按时间顺序排列的思维链数组（从旧到新）
 */
export function extractAllDatServerThoughtChains(messages: any[]): ThoughtChainData[] {
    const toolCallsWithChains = extractAllDatServerToolCallsWithThoughtChains(messages);
    return toolCallsWithChains
        .map((item) => item.thoughtChain)
        .filter((chain): chain is ThoughtChainData => chain !== null);
}

/**
 * 从消息中提取所有工具调用（包括 becauseai-server 和其他工具）
 * 返回按时间顺序排列的数组（从旧到新）
 */
export function extractAllToolCalls(messages: any[]): ToolCallWithThoughtChain[] {
    if (!messages || messages.length === 0) {
        return [];
    }

    const result: ToolCallWithThoughtChain[] = [];

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (!message || !message.content || !Array.isArray(message.content)) {
            continue;
        }

        for (const part of message.content) {
            if (!part || part.type !== ContentTypes.TOOL_CALL) {
                continue;
            }

            const toolCall = part[ContentTypes.TOOL_CALL] || part.tool_call;
            if (!toolCall) {
                continue;
            }

            const functionData = toolCall.function || toolCall;
            if (!functionData || !functionData.name) {
                continue;
            }

            const toolName = functionData.name || '';
            const output = functionData.output || toolCall.output;

            let isDatServerTool = false;
            let thoughtChain: ThoughtChainData | null = null;

            if (toolName.includes(Constants.mcp_delimiter)) {
                const [, serverName] = toolName.split(Constants.mcp_delimiter);
                if (serverName === 'becauseai-server') {
                    isDatServerTool = true;
                }
            } else if (toolName.includes('becauseai-server')) {
                isDatServerTool = true;
            }

            if (isDatServerTool && output && typeof output === 'string') {
                thoughtChain = parseDatServerResponse(output);
            }

            const toolCallInfo: ToolCallInfo = {
                name: toolName,
                args: functionData.arguments || toolCall.args || '',
                output: output,
                id: toolCall.id || functionData.id,
                progress: toolCall.progress,
                auth: toolCall.auth,
                expires_at: toolCall.expires_at,
            };

            result.push({
                thoughtChain,
                toolCall: toolCallInfo,
            });
        }
    }

    return result;
}

/**
 * 从消息中提取所有 becauseai-server 工具调用及其对应的思维链数据
 * 返回按时间顺序排列的数组（从旧到新）
 * @deprecated 使用 extractAllToolCalls 获取所有工具调用
 */
export function extractAllDatServerToolCallsWithThoughtChains(
    messages: any[],
): ToolCallWithThoughtChain[] {
    return extractAllToolCalls(messages).filter((item) => item.thoughtChain !== null);
}

/**
 * 从消息中提取工具调用，按消息分组
 * 支持多轮对话的思维链展示
 */
export function extractToolCallsByMessage(messages: any[]): MessageToolCalls[] {
    if (!messages || messages.length === 0) {
        return [];
    }

    const result: MessageToolCalls[] = [];
    let roundIndex = 0;

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (!message || !message.content || !Array.isArray(message.content)) {
            continue;
        }

        const messageToolCalls: ToolCallWithThoughtChain[] = [];
        let hasToolCall = false;

        for (const part of message.content) {
            if (!part || part.type !== ContentTypes.TOOL_CALL) {
                continue;
            }

            hasToolCall = true;
            const toolCall = part[ContentTypes.TOOL_CALL] || part.tool_call;
            if (!toolCall) {
                continue;
            }

            const functionData = toolCall.function || toolCall;
            if (!functionData || !functionData.name) {
                continue;
            }

            const toolName = functionData.name || "";
            const output = functionData.output || toolCall.output;

            let isDatServerTool = false;
            let thoughtChain: ThoughtChainData | null = null;

            if (toolName.includes(Constants.mcp_delimiter)) {
                const [, serverName] = toolName.split(Constants.mcp_delimiter);
                if (serverName === 'becauseai-server') {
                    isDatServerTool = true;
                }
            } else if (toolName.includes("becauseai-server")) {
              isDatServerTool = true;
            }

            if (isDatServerTool && output && typeof output === 'string') {
                thoughtChain = parseDatServerResponse(output);
            }

            const toolCallInfo: ToolCallInfo = {
                name: toolName,
                args: functionData.arguments || toolCall.args || '',
                output: output,
                id: toolCall.id || functionData.id,
                progress: toolCall.progress,
                auth: toolCall.auth,
                expires_at: toolCall.expires_at,
            };

            messageToolCalls.push({
                thoughtChain,
                toolCall: toolCallInfo,
            });
        }

        if (hasToolCall) {
            roundIndex++;
            const isStreaming =
                message.unfinished === true ||
                messageToolCalls.some(
                    (tc) =>
                        tc.toolCall.output == null ||
                        tc.toolCall.output === '' ||
                        (tc.toolCall.progress != null && tc.toolCall.progress < 1),
                );
            result.push({
                messageId: message.messageId || `msg-${i}`,
                messageIndex: roundIndex,
                toolCalls: messageToolCalls,
                isStreaming,
            });
        }
    }

    return result;
}

/**
 * 从消息中提取 becauseai-server 工具调用的思维链数据（仅返回最新的一个，保持向后兼容）
 * @deprecated 使用 extractAllDatServerThoughtChains 获取所有思维链
 */
export function extractDatServerThoughtChain(messages: any[]): ThoughtChainData | null {
    const allChains = extractAllDatServerThoughtChains(messages);
    return allChains.length > 0 ? allChains[allChains.length - 1] : null;
}
