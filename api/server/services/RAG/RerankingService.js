const { logger } = require('@aipyq/data-schemas');
const ONNXRerankingService = require('./ONNXRerankingService');

/**
 * 重排服务
 * 负责对检索结果进行重排序优化
 * 优先使用本地 ONNX 模型
 */
class RerankingService {
  constructor() {
    this.rerankerType = process.env.RERANKER_TYPE || 'onnx'; // 默认使用 ONNX
    this.useONNX = process.env.USE_ONNX_RERANKER !== 'false'; // 默认启用 ONNX
    this.onnxRerankingService = new ONNXRerankingService();
    this.reranker = this.createReranker();
  }

  /**
   * 创建重排器实例
   * @returns {Object|null} 重排器实例
   */
  createReranker() {
    try {
      // 优先使用本地 ONNX 模型
      if (this.useONNX && this.rerankerType === 'onnx') {
        logger.info('[RerankingService] 使用本地 ONNX 重排模型');
        return {
          type: 'onnx',
          service: this.onnxRerankingService,
        };
      }

      // 如果配置了其他重排器类型，尝试从 agents-because 导入
      if (this.rerankerType !== 'onnx' && this.rerankerType !== 'none') {
        try {
          const { createReranker } = require('../../../../agents-because/src/tools/search/rerankers');
          
          const reranker = createReranker({
            rerankerType: this.rerankerType,
            jinaApiKey: process.env.JINA_API_KEY,
            jinaApiUrl: process.env.JINA_API_URL,
            cohereApiKey: process.env.COHERE_API_KEY,
          });

          if (reranker) {
            logger.info(`[RerankingService] 使用外部重排器: ${this.rerankerType}`);
            return {
              type: this.rerankerType,
              service: reranker,
            };
          }
        } catch (importError) {
          logger.warn('[RerankingService] 无法导入外部重排器，使用默认重排:', importError.message);
        }
      }

      // 默认重排：基于相似度分数
      return null;
    } catch (error) {
      logger.error('[RerankingService] 创建重排器失败:', error);
      return null;
    }
  }

  /**
   * 重排检索结果
   * @param {Object} params
   * @param {string} params.query - 原始查询文本
   * @param {Array} params.results - 检索结果数组
   * @param {number} [params.topK] - 返回前K个结果
   * @returns {Promise<Array>} 重排后的结果数组
   */
  async rerank({ query, results, topK = 10 }) {
    if (!results || results.length === 0) {
      return [];
    }

    try {
      // 如果使用 ONNX 重排器
      if (this.reranker && this.reranker.type === 'onnx' && this.reranker.service) {
        // 提取文档文本
        const documents = results.map(result => result.content || result.text || '');

        // 调用 ONNX 重排器
        const rerankedHighlights = await this.reranker.service.rerank(query, documents, topK);

        // 检查重排分数是否都相同（可能是模型问题）
        const rerankScores = rerankedHighlights.map(h => h.score || 0);
        const allSameScore = rerankScores.length > 1 && 
          rerankScores.every(s => Math.abs(s - rerankScores[0]) < 0.0001);
        
        if (allSameScore) {
          logger.warn(`[RerankingService] 警告：重排器返回的所有分数都相同 (${rerankScores[0].toFixed(4)})，使用原始检索分数`);
        }

        // 将重排结果映射回原始结果
        const rerankedResults = rerankedHighlights.map(highlight => {
          // 找到对应的原始结果
          const originalResult = results.find(
            r => (r.content || r.text || '') === highlight.text
          );

          if (originalResult) {
            // 如果重排分数都相同，使用原始分数；否则使用重排分数
            const finalScore = allSameScore 
              ? (originalResult.score || originalResult.similarity || 0)
              : (highlight.score !== undefined && highlight.score !== null ? highlight.score : (originalResult.score || originalResult.similarity || 0));
            
            return {
              ...originalResult,
              score: finalScore,
              similarity: finalScore,
              reranked: !allSameScore, // 如果分数都相同，标记为未重排
              originalScore: originalResult.score || originalResult.similarity || 0, // 保留原始分数用于调试
            };
          }

          // 如果找不到原始结果，创建新结果
          return {
            content: highlight.text,
            score: highlight.score || 0,
            similarity: highlight.score || 0,
            reranked: !allSameScore,
          };
        });

        // 记录分数分布用于调试
        if (rerankedResults.length > 0) {
          const scores = rerankedResults.map(r => r.score || 0);
          const minScore = Math.min(...scores);
          const maxScore = Math.max(...scores);
          const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
          logger.info(`[RerankingService] 使用 ONNX 重排了 ${rerankedResults.length} 个结果，分数范围: ${(minScore * 100).toFixed(1)}% - ${(maxScore * 100).toFixed(1)}%，平均: ${(avgScore * 100).toFixed(1)}%`);
        } else {
          logger.info(`[RerankingService] 使用 ONNX 重排了 ${rerankedResults.length} 个结果`);
        }
        return rerankedResults;
      }

      // 如果使用外部重排器（Jina、Cohere 等）
      if (this.reranker && this.reranker.service && typeof this.reranker.service.rerank === 'function') {
        // 提取文档文本
        const documents = results.map(result => result.content || result.text || '');

        // 调用重排器
        const rerankedHighlights = await this.reranker.service.rerank(query, documents, topK);

        // 检查重排分数是否都相同
        const rerankScores = rerankedHighlights.map(h => h.score || 0);
        const allSameScore = rerankScores.length > 1 && 
          rerankScores.every(s => Math.abs(s - rerankScores[0]) < 0.0001);
        
        if (allSameScore) {
          logger.warn(`[RerankingService] 警告：重排器返回的所有分数都相同 (${rerankScores[0].toFixed(4)})，使用原始检索分数`);
        }

        // 将重排结果映射回原始结果
        const rerankedResults = rerankedHighlights.map(highlight => {
          const originalResult = results.find(
            r => (r.content || r.text || '') === highlight.text
          );

          if (originalResult) {
            // 如果重排分数都相同，使用原始分数；否则使用重排分数
            const finalScore = allSameScore 
              ? (originalResult.score || originalResult.similarity || 0)
              : (highlight.score !== undefined && highlight.score !== null ? highlight.score : (originalResult.score || originalResult.similarity || 0));
            
            return {
              ...originalResult,
              score: finalScore,
              similarity: finalScore,
              reranked: !allSameScore,
              originalScore: originalResult.score || originalResult.similarity || 0,
            };
          }

          return {
            content: highlight.text,
            score: highlight.score || 0,
            similarity: highlight.score || 0,
            reranked: !allSameScore,
          };
        });

        // 记录分数分布用于调试
        if (rerankedResults.length > 0) {
          const scores = rerankedResults.map(r => r.score || 0);
          const minScore = Math.min(...scores);
          const maxScore = Math.max(...scores);
          const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
          logger.info(`[RerankingService] 使用 ${this.reranker.type} 重排了 ${rerankedResults.length} 个结果，分数范围: ${(minScore * 100).toFixed(1)}% - ${(maxScore * 100).toFixed(1)}%，平均: ${(avgScore * 100).toFixed(1)}%`);
        } else {
          logger.info(`[RerankingService] 使用 ${this.reranker.type} 重排了 ${rerankedResults.length} 个结果`);
        }
        return rerankedResults;
      }

      // 默认重排：按分数排序
      const sortedResults = results
        .map(result => ({
          ...result,
          reranked: false,
        }))
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, topK);

      logger.info(`[RerankingService] 使用默认排序，返回 ${sortedResults.length} 个结果`);
      return sortedResults;
    } catch (error) {
      logger.error('[RerankingService] 重排失败，使用原始结果:', error);
      // 失败时返回原始结果（已排序）
      return results
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, topK);
    }
  }

  /**
   * 增强重排：结合多种因素进行重排
   * @param {Object} params
   * @param {string} params.query - 原始查询文本
   * @param {Array} params.results - 检索结果数组
   * @param {number} [params.topK] - 返回前K个结果
   * @param {Object} [params.weights] - 权重配置
   * @returns {Promise<Array>} 增强重排后的结果
   */
  async enhancedRerank({ query, results, topK = 10, weights = {} }) {
    if (!results || results.length === 0) {
      return [];
    }

    try {
      const {
        similarityWeight = 0.7, // 相似度权重
        typeWeight = 0.2, // 类型权重
        recencyWeight = 0.1, // 时效性权重
      } = weights;

      // 1. 先使用基础重排
      const baseReranked = await this.rerank({ query, results, topK: topK * 2 });

      // 2. 计算增强分数
      const enhancedResults = baseReranked.map((result, index) => {
        // 相似度分数（已归一化到0-1）
        const similarityScore = result.score || result.similarity || 0;

        // 类型权重（语义模型和QA对优先级更高）
        let typeScore = 0.5; // 默认
        if (result.type === 'semantic_model' || result.type === 'qa_pair') {
          typeScore = 1.0;
        } else if (result.type === 'business_knowledge') {
          typeScore = 0.8;
        } else if (result.type === 'synonym') {
          typeScore = 0.6;
        }

        // 时效性分数（基于排名，越靠前分数越高）
        const recencyScore = 1.0 - index / baseReranked.length;

        // 综合分数
        const enhancedScore =
          similarityScore * similarityWeight +
          typeScore * typeWeight +
          recencyScore * recencyWeight;

        return {
          ...result,
          score: enhancedScore,
          similarity: enhancedScore,
          enhanced: true,
        };
      });

      // 3. 按增强分数重新排序
      const finalResults = enhancedResults
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      logger.info(`[RerankingService] 增强重排返回 ${finalResults.length} 个结果`);
      return finalResults;
    } catch (error) {
      logger.error('[RerankingService] 增强重排失败，使用基础重排:', error);
      return await this.rerank({ query, results, topK });
    }
  }
}

module.exports = RerankingService;

