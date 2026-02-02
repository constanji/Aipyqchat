const { logger } = require('@aipyq/data-schemas');
const EmbeddingService = require('./EmbeddingService');
const KnowledgeBaseService = require('./KnowledgeBaseService');
const RetrievalService = require('./RetrievalService');
const RerankingService = require('./RerankingService');
// 从编译后的包中导入，或使用本地 JavaScript 文件
let KnowledgeType;
try {
  KnowledgeType = require('@aipyq/data-schemas/schema/knowledgeBase').KnowledgeType;
} catch (e) {
  try {
    KnowledgeType = require('../../../../packages/data-schemas/src/schema/knowledgeBase').KnowledgeType;
  } catch (e2) {
    KnowledgeType = {
      SEMANTIC_MODEL: 'semantic_model',
      QA_PAIR: 'qa_pair',
      SYNONYM: 'synonym',
      BUSINESS_KNOWLEDGE: 'business_knowledge',
      FILE: 'file',
    };
  }
}

/**
 * RAG 服务主类
 * 整合向量化、知识库管理、检索和重排功能
 */
class RAGService {
  constructor() {
    this.embeddingService = new EmbeddingService();
    this.knowledgeBaseService = new KnowledgeBaseService();
    this.retrievalService = new RetrievalService();
    this.rerankingService = new RerankingService();
  }

  /**
   * 完整的 RAG 查询流程
   * 问题向量化 --> 语义模型/QA对/同义词/业务知识 向量检索 --> 重排优化
   * 
   * @param {Object} params
   * @param {string} params.query - 用户问题
   * @param {string} params.userId - 用户ID
   * @param {Object} [params.options] - 查询选项
   * @param {string[]} [params.options.types] - 要检索的知识类型
   * @param {string[]} [params.options.fileIds] - 文件ID数组
   * @param {string} [params.options.entityId] - 实体ID
   * @param {number} [params.options.topK] - 返回数量
   * @param {boolean} [params.options.useReranking] - 是否使用重排
   * @param {boolean} [params.options.enhancedReranking] - 是否使用增强重排
   * @returns {Promise<Object>} RAG查询结果
   */
  async query({
    query,
    userId,
    options = {},
  }) {
    try {
      const {
        types,
        fileIds,
        entityId,
        topK = 10,
        useReranking = true,
        enhancedReranking = false,
      } = options;

      logger.info(`[RAGService] 开始RAG查询: "${query.substring(0, 50)}..."`);

      // 步骤1: 问题向量化（在检索服务内部完成）
      // 步骤2: 向量检索
      const retrievalResults = await this.retrievalService.hybridRetrieve({
        query,
        userId,
        fileIds,
        types: types || [
          KnowledgeType.SEMANTIC_MODEL,
          KnowledgeType.QA_PAIR,
          KnowledgeType.SYNONYM,
          KnowledgeType.BUSINESS_KNOWLEDGE,
        ],
        entityId,
        topK: useReranking ? topK * 2 : topK, // 如果使用重排，检索更多结果
      });

      logger.info(`[RAGService] 检索到 ${retrievalResults.length} 个结果`);

      // 步骤3: 重排优化
      let finalResults = retrievalResults;
      if (useReranking && retrievalResults.length > 0) {
        if (enhancedReranking) {
          finalResults = await this.rerankingService.enhancedRerank({
            query,
            results: retrievalResults,
            topK,
          });
        } else {
          finalResults = await this.rerankingService.rerank({
            query,
            results: retrievalResults,
            topK,
          });
        }
        logger.info(`[RAGService] 重排后返回 ${finalResults.length} 个结果`);
      }

      // 格式化结果
      const formattedResults = this.formatResults(finalResults);

      return {
        query,
        results: formattedResults,
        total: finalResults.length,
        metadata: {
          retrievalCount: retrievalResults.length,
          reranked: useReranking,
          enhancedReranking,
        },
      };
    } catch (error) {
      logger.error('[RAGService] RAG查询失败:', error);
      throw error;
    }
  }

  /**
   * 格式化检索结果
   * @param {Array} results - 原始结果数组
   * @returns {Array} 格式化后的结果数组
   */
  formatResults(results) {
    return results.map((result, index) => {
      const formatted = {
        rank: index + 1,
        type: result.type,
        title: result.title || '未命名',
        content: result.content || result.text || '',
        score: result.score || result.similarity || 0,
        metadata: result.metadata || {},
      };

      // 根据类型添加特定信息
      switch (result.type) {
        case KnowledgeType.SEMANTIC_MODEL:
          formatted.semanticModelId = result.metadata?.semantic_model_id;
          formatted.databaseName = result.metadata?.database_name;
          formatted.tableName = result.metadata?.table_name;
          break;
        case KnowledgeType.QA_PAIR:
          formatted.question = result.metadata?.question;
          formatted.answer = result.metadata?.answer;
          break;
        case KnowledgeType.SYNONYM:
          formatted.noun = result.metadata?.noun;
          formatted.synonyms = result.metadata?.synonyms;
          break;
        case KnowledgeType.BUSINESS_KNOWLEDGE:
          formatted.category = result.metadata?.category;
          formatted.tags = result.metadata?.tags;
          break;
        case KnowledgeType.FILE:
          formatted.fileId = result.metadata?.file_id;
          formatted.filename = result.metadata?.filename;
          formatted.page = result.metadata?.page;
          break;
      }

      return formatted;
    });
  }

  /**
   * 添加知识条目到知识库
   * @param {Object} params
   * @param {string} params.userId - 用户ID
   * @param {string} params.type - 知识类型
   * @param {Object} params.data - 知识数据
   * @returns {Promise<Object>} 创建的知识条目
   */
  async addKnowledge({ userId, type, data }) {
    try {
      switch (type) {
        case KnowledgeType.SEMANTIC_MODEL:
          // 检查是否为数据库级别的批量导入
          if (data.isDatabaseLevel && data.semanticModels && data.databaseContent) {
            return await this.knowledgeBaseService.addDatabaseSemanticModel({
              userId,
              databaseName: data.databaseName,
              semanticModels: data.semanticModels,
              databaseContent: data.databaseContent,
              metadata: data.metadata || {},
            });
          }
          return await this.knowledgeBaseService.addSemanticModel({
            userId,
            ...data,
          });
        case KnowledgeType.QA_PAIR:
          return await this.knowledgeBaseService.addQAPair({
            userId,
            ...data,
          });
        case KnowledgeType.SYNONYM:
          return await this.knowledgeBaseService.addSynonym({
            userId,
            ...data,
          });
        case KnowledgeType.BUSINESS_KNOWLEDGE:
          return await this.knowledgeBaseService.addBusinessKnowledge({
            userId,
            ...data,
          });
        default:
          throw new Error(`不支持的知识类型: ${type}`);
      }
    } catch (error) {
      logger.error('[RAGService] 添加知识失败:', error);
      throw error;
    }
  }

  /**
   * 批量添加知识条目
   * @param {Object} params
   * @param {string} params.userId - 用户ID
   * @param {Array} params.entries - 知识条目数组
   * @returns {Promise<Array>} 创建的知识条目数组
   */
  async addKnowledgeBatch({ userId, entries }) {
    return await this.knowledgeBaseService.addKnowledgeEntries({
      userId,
      entries,
    });
  }

  /**
   * 更新知识条目
   * @param {Object} params
   * @param {string} params.entryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @param {string} params.type - 知识类型
   * @param {Object} params.data - 更新数据
   * @returns {Promise<Object>} 更新后的知识条目
   */
  async updateKnowledge({ entryId, userId, type, data }) {
    try {
      switch (type) {
        case KnowledgeType.QA_PAIR:
          return await this.knowledgeBaseService.updateQAPair({
            entryId,
            userId,
            ...data,
          });
        case KnowledgeType.SYNONYM:
          return await this.knowledgeBaseService.updateSynonym({
            entryId,
            userId,
            ...data,
          });
        case KnowledgeType.BUSINESS_KNOWLEDGE:
          return await this.knowledgeBaseService.updateBusinessKnowledge({
            entryId,
            userId,
            ...data,
          });
        default:
          throw new Error(`不支持更新类型: ${type}`);
      }
    } catch (error) {
      logger.error('[RAGService] 更新知识失败:', error);
      throw error;
    }
  }

  /**
   * 删除知识条目
   * @param {Object} params
   * @param {string} params.entryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @returns {Promise<boolean>} 是否删除成功
   */
  async deleteKnowledge({ entryId, userId }) {
    return await this.knowledgeBaseService.deleteKnowledgeEntry({
      entryId,
      userId,
    });
  }

  /**
   * 获取知识条目列表
   * @param {Object} params
   * @param {string} [params.userId] - 用户ID（可选，不传递则查询所有用户的知识，支持共享知识库）
   * @param {Object} [params.filters] - 过滤条件
   * @returns {Promise<Array>} 知识条目数组
   */
  async getKnowledgeList({ userId, filters = {} }) {
    return await this.knowledgeBaseService.getKnowledgeEntries({
      userId: userId || undefined, // 如果userId为undefined，则不进行用户过滤，支持共享知识库
      ...filters,
    });
  }
}

module.exports = RAGService;

