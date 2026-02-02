/**
 * 对话 RAG 服务
 * 在对话过程中将用户问题向量化并检索相关知识
 */

const RAGService = require('./RAGService');
const EmbeddingService = require('./EmbeddingService');
const VectorDBService = require('./VectorDBService');
const { logger } = require('~/config');

class ConversationRAGService {
  constructor() {
    this.ragService = new RAGService();
    this.embeddingService = new EmbeddingService();
    this.vectorDBService = new VectorDBService();
    
    // 默认配置
    this.defaultConfig = {
      enabled: true,
      topK: 5,
      minScore: 0.5,
      maxContextLength: 2000,
      useReranking: false,
    };
  }

  /**
   * 在对话中检索相关知识
   * @param {Object} params
   * @param {string} params.query - 用户问题
   * @param {string} params.userId - 用户ID
   * @param {string} params.agentId - 智能体ID
   * @param {string[]} params.fileIds - 可选的文件ID列表
   * @param {Object} params.config - 可选的配置覆盖
   * @returns {Promise<Object>} 检索结果
   */
  async retrieveForConversation({
    query,
    userId,
    agentId,
    fileIds,
    config = {},
  }) {
    const finalConfig = { ...this.defaultConfig, ...config };
    
    if (!finalConfig.enabled) {
      return { results: [], context: '', enabled: false };
    }

    try {
      logger.info(`[ConversationRAG] 开始对话检索: "${query.substring(0, 50)}..."`);
      
      // 使用 RAGService 进行检索
      // 如果智能体没有关联文件，则不使用 entityId 隔离，检索用户的全局知识库
      const useEntityId = fileIds && fileIds.length > 0;
      logger.info(`[ConversationRAG] 检索配置 - userId: ${userId}, agentId: ${agentId}, useEntityId: ${useEntityId}, fileIds: ${fileIds?.length || 0}`);
      
      const ragResult = await this.ragService.query({
        query,
        userId,
        options: {
          entityId: useEntityId ? agentId : undefined,  // 没有关联文件时不使用数据源隔离
          fileIds,
          topK: finalConfig.topK,
          useReranking: finalConfig.useReranking,
          minScore: finalConfig.minScore,
        },
      });

      // 过滤低分结果
      const filteredResults = ragResult.results.filter(
        r => (r.score || r.similarity || 0) >= finalConfig.minScore
      );

      // 构建上下文
      const context = this.buildContext(filteredResults, finalConfig.maxContextLength);

      logger.info(`[ConversationRAG] 检索完成: 找到 ${filteredResults.length} 条相关知识`);

      return {
        results: filteredResults,
        context,
        enabled: true,
        metadata: {
          query,
          totalResults: ragResult.total,
          filteredResults: filteredResults.length,
          config: finalConfig,
        },
      };
    } catch (error) {
      logger.error('[ConversationRAG] 对话检索失败:', error);
      return {
        results: [],
        context: '',
        enabled: true,
        error: error.message,
      };
    }
  }

  /**
   * 快速检索（跳过重排序）
   */
  async quickRetrieve({ query, userId, agentId, topK = 3 }) {
    return this.retrieveForConversation({
      query,
      userId,
      agentId,
      config: {
        topK,
        useReranking: false,
        minScore: 0.4,
      },
    });
  }

  /**
   * 构建上下文字符串
   * @param {Array} results - 检索结果
   * @param {number} maxLength - 最大长度
   * @returns {string} 格式化的上下文
   */
  buildContext(results, maxLength = 2000) {
    if (!results || results.length === 0) {
      return '';
    }

    let context = '【相关知识库内容】\n\n';
    let currentLength = context.length;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const content = result.content || result.text || result.pageContent || '';
      const source = result.source || result.metadata?.source || '未知来源';
      const score = (result.score || result.similarity || 0).toFixed(2);

      const entry = `[${i + 1}] (相关度: ${score})\n来源: ${source}\n内容: ${content}\n\n`;

      if (currentLength + entry.length > maxLength) {
        // 截断并添加提示
        const remainingSpace = maxLength - currentLength - 50;
        if (remainingSpace > 100) {
          context += entry.substring(0, remainingSpace) + '...(已截断)\n';
        }
        break;
      }

      context += entry;
      currentLength += entry.length;
    }

    return context;
  }

  /**
   * 判断是否应该进行 RAG 检索
   * @param {string} query - 用户问题
   * @returns {boolean}
   */
  shouldRetrieve(query) {
    if (!query || query.trim().length < 2) {
      return false;
    }

    // 过滤一些简单的问候语和确认语
    const skipPatterns = [
      /^(你好|您好|hi|hello|hey)[\s!！。.]*$/i,
      /^(好的|ok|okay|是的|对|嗯|行|可以|明白|了解|知道了|收到)[\s!！。.]*$/i,
      /^(谢谢|感谢|thanks|thank you)[\s!！。.]*$/i,
      /^(再见|拜拜|bye|goodbye)[\s!！。.]*$/i,
      /^暂时没有/i,
      /^没有了/i,
      /^继续/i,
      /^开始/i,
    ];

    for (const pattern of skipPatterns) {
      if (pattern.test(query.trim())) {
        logger.debug(`[ConversationRAG] 跳过简单问候/确认: "${query}"`);
        return false;
      }
    }

    return true;
  }

  /**
   * 从智能体配置中提取 RAG 配置
   * @param {Object} agent - 智能体对象
   * @returns {Object} RAG 配置
   */
  getAgentRAGConfig(agent) {
    // 获取智能体关联的文件
    const fileIds = agent?.file_ids || agent?.fileIds || [];
    
    // 检查智能体是否显式禁用了 RAG
    // 默认启用 RAG（即使没有关联文件，也可以检索全局知识库）
    const ragEnabled = agent?.rag?.enabled !== false;

    return {
      ...this.defaultConfig,
      enabled: ragEnabled,  // 不再要求必须有关联文件
      fileIds,
      topK: agent?.rag?.topK || this.defaultConfig.topK,
      minScore: agent?.rag?.minScore || this.defaultConfig.minScore,
      useReranking: agent?.rag?.useReranking || this.defaultConfig.useReranking,
    };
  }
}

module.exports = ConversationRAGService;
