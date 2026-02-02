const { logger } = require('@aipyq/data-schemas');
const ONNXEmbeddingService = require('./ONNXEmbeddingService');

/**
 * 向量化服务
 * 负责将文本转换为向量嵌入
 * 优先使用本地 ONNX 模型
 */
class EmbeddingService {
  constructor() {
    this.ragApiUrl = process.env.RAG_API_URL;
    this.embeddingModel = process.env.EMBEDDING_MODEL || 'onnx'; // 默认使用 ONNX
    this.onnxEmbeddingService = new ONNXEmbeddingService();
    this.useONNX = process.env.USE_ONNX_EMBEDDING !== 'false'; // 默认启用 ONNX
  }

  /**
   * 将文本转换为向量嵌入
   * 优先使用本地 ONNX 模型，如果不可用则回退到其他服务
   * 
   * @param {string} text - 要向量化的文本
   * @param {string} userId - 用户ID（用于生成token，可选）
   * @returns {Promise<number[]>} 向量嵌入数组
   */
  async embedText(text, userId) {
    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    try {
      // 方案1：优先使用本地 ONNX 模型
      if (this.useONNX) {
        try {
          const embedding = await this.onnxEmbeddingService.embedText(text);
          logger.info(`[EmbeddingService] 成功使用ONNX模型向量化文本 (维度: ${embedding.length})`);
          logger.debug('Successfully embedded text using ONNX model');
          return embedding;
        } catch (onnxError) {
          // 如果是因为缺少 @xenova/transformers，记录警告但不抛出错误
          if (onnxError.message && onnxError.message.includes('@xenova/transformers')) {
            logger.warn('ONNX embedding not available: @xenova/transformers not installed. Install it with: npm install @xenova/transformers');
          } else {
            logger.warn('ONNX embedding failed, falling back to other methods:', onnxError.message);
          }
          // 继续尝试其他方法
        }
      }

      // 方案2：如果配置了 RAG API，尝试使用（可选）
      if (this.ragApiUrl && userId) {
        try {
          const axios = require('axios');
          const { generateShortLivedToken } = require('@aipyq/api');
          const jwtToken = generateShortLivedToken(userId);

          const response = await axios.post(
            `${this.ragApiUrl}/embed/text`,
            { text },
            {
              headers: {
                Authorization: `Bearer ${jwtToken}`,
                'Content-Type': 'application/json',
              },
              timeout: 30000,
            }
          );

          if (response.data && response.data.embedding) {
            logger.info(`[EmbeddingService] 成功使用RAG API向量化文本 (维度: ${response.data.embedding.length})`);
            logger.debug('Successfully embedded text using RAG API');
            return response.data.embedding;
          }
        } catch (apiError) {
          logger.warn('RAG API text embedding endpoint not available', apiError.message);
        }
      }

      // 方案3：使用其他本地嵌入服务（OpenAI 等）
      try {
        return await this.embedTextLocal(text);
      } catch (localError) {
        // 如果所有方法都失败，记录错误但不抛出异常
        // 允许知识条目在没有 embedding 的情况下保存
        logger.warn('All embedding methods failed. Knowledge entry will be saved without embedding:', localError.message);
        // 返回 null 而不是抛出错误，让调用者决定如何处理
        return null;
      }
    } catch (error) {
      logger.error('Error embedding text:', error);
      // 如果所有方法都失败，返回 null 而不是抛出错误
      logger.warn('Embedding failed, but allowing knowledge entry to be saved without embedding');
      return null;
    }
  }

  /**
   * 本地文本嵌入（备用方案）
   * 支持多种嵌入模型：
   * 1. OpenAI Embeddings (需要 OPENAI_API_KEY)
   * 2. 直接使用 OpenAI SDK (如果 @langchain/openai 不可用)
   * 3. 其他本地嵌入模型（可扩展）
   * 
   * @param {string} text - 要向量化的文本
   * @returns {Promise<number[]>} 向量嵌入数组
   */
  async embedTextLocal(text) {
    try {
      // 优先使用配置的嵌入模型
      const embeddingModel = process.env.EMBEDDING_MODEL || 'openai';
      
      switch (embeddingModel.toLowerCase()) {
        case 'openai':
          return await this.embedWithOpenAI(text);
        
        case 'openai-sdk':
          // 直接使用 OpenAI SDK（不依赖 @langchain/openai）
          return await this.embedWithOpenAISDK(text);
        
        // 可以扩展其他模型，例如：
        // case 'bge':
        //   return await this.embedWithBGE(text);
        // case 'huggingface':
        //   return await this.embedWithHuggingFace(text);
        
        default:
          // 默认尝试 OpenAI
          return await this.embedWithOpenAI(text);
      }
    } catch (error) {
      logger.error('Error in local embedding:', error);
      // 如果配置了允许无 embedding，返回 null
      if (process.env.ALLOW_NO_EMBEDDING === 'true') {
        logger.warn('ALLOW_NO_EMBEDDING is enabled, returning null for embedding');
        return null;
      }
      throw error;
    }
  }

  /**
   * 使用 LangChain OpenAI Embeddings
   * @param {string} text - 要向量化的文本
   * @returns {Promise<number[]>} 向量嵌入数组
   */
  async embedWithOpenAI(text) {
    if (!process.env.OPENAI_API_KEY) {
      // 如果没有配置 API Key，且允许无 embedding，返回 null
      if (process.env.ALLOW_NO_EMBEDDING === 'true') {
        logger.warn('OPENAI_API_KEY not configured, but ALLOW_NO_EMBEDDING is enabled');
        return null;
      }
      throw new Error('OPENAI_API_KEY not configured for local embedding');
    }

    try {
      // 尝试使用 @langchain/openai（如果已安装）
      const { OpenAIEmbeddings } = require('@langchain/openai');
      const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002',
        timeout: 30000, // 30秒超时
      });

      const result = await embeddings.embedQuery(text);
      logger.info(`[EmbeddingService] 成功使用LangChain OpenAI向量化文本 (维度: ${result.length})`);
      logger.debug(`Successfully embedded text using LangChain OpenAI (length: ${result.length})`);
      return result;
    } catch (langchainError) {
      // 如果 @langchain/openai 不可用，回退到 OpenAI SDK
      if (langchainError.code === 'MODULE_NOT_FOUND') {
        logger.warn('@langchain/openai not found, falling back to OpenAI SDK');
        return await this.embedWithOpenAISDK(text);
      }
      // 如果是 401 错误（认证失败），且允许无 embedding，返回 null
      if (process.env.ALLOW_NO_EMBEDDING === 'true' && (langchainError.status === 401 || langchainError.message?.includes('401'))) {
        logger.warn('OpenAI authentication failed (401), but ALLOW_NO_EMBEDDING is enabled, returning null');
        return null;
      }
      // 如果允许无 embedding，返回 null
      if (process.env.ALLOW_NO_EMBEDDING === 'true') {
        logger.warn('LangChain OpenAI embedding failed, but ALLOW_NO_EMBEDDING is enabled, returning null');
        return null;
      }
      throw langchainError;
    }
  }

  /**
   * 直接使用 OpenAI SDK 进行嵌入
   * 不需要 @langchain/openai 依赖
   * @param {string} text - 要向量化的文本
   * @returns {Promise<number[]>} 向量嵌入数组
   */
  async embedWithOpenAISDK(text) {
    if (!process.env.OPENAI_API_KEY) {
      // 如果没有配置 API Key，且允许无 embedding，返回 null
      if (process.env.ALLOW_NO_EMBEDDING === 'true') {
        logger.warn('OPENAI_API_KEY not configured, but ALLOW_NO_EMBEDDING is enabled');
        return null;
      }
      throw new Error('OPENAI_API_KEY not configured for local embedding');
    }

    try {
      const { default: OpenAI } = require('openai');
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 30000,
      });

      const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-ada-002';
      
      const response = await openai.embeddings.create({
        model: model,
        input: text.replace(/\n/g, ' '), // 替换换行符
      });

      if (!response.data || response.data.length === 0) {
        // 如果允许无 embedding，返回 null
        if (process.env.ALLOW_NO_EMBEDDING === 'true') {
          logger.warn('OpenAI API returned empty embedding data, but ALLOW_NO_EMBEDDING is enabled');
          return null;
        }
        throw new Error('OpenAI API returned empty embedding data');
      }

      const embedding = response.data[0].embedding;
      logger.info(`[EmbeddingService] 成功使用OpenAI SDK向量化文本 (维度: ${embedding.length})`);
      logger.debug(`Successfully embedded text using OpenAI SDK (length: ${embedding.length})`);
      return embedding;
    } catch (error) {
      logger.error('Error in OpenAI SDK embedding:', error);
      // 如果允许无 embedding，返回 null
      if (process.env.ALLOW_NO_EMBEDDING === 'true') {
        logger.warn('OpenAI embedding failed, but ALLOW_NO_EMBEDDING is enabled, returning null');
        return null;
      }
      throw new Error(`OpenAI embedding failed: ${error.message}`);
    }
  }

  /**
   * 使用 BGE (BAAI General Embedding) 模型进行嵌入
   * 需要安装相应的包，例如：@xenova/transformers
   * 
   * @param {string} text - 要向量化的文本
   * @returns {Promise<number[]>} 向量嵌入数组
   */
  async embedWithBGE(text) {
    // TODO: 实现 BGE 嵌入
    // 示例代码（需要安装 @xenova/transformers）:
    /*
    const { pipeline } = require('@xenova/transformers');
    const generateEmbedding = await pipeline(
      'feature-extraction',
      'BAAI/bge-small-zh-v15'
    );
    const output = await generateEmbedding(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
    */
    throw new Error('BGE embedding not implemented yet. Please install @xenova/transformers first.');
  }

  /**
   * 使用 HuggingFace 模型进行嵌入
   * 需要安装相应的包和配置
   * 
   * @param {string} text - 要向量化的文本
   * @returns {Promise<number[]>} 向量嵌入数组
   */
  async embedWithHuggingFace(text) {
    // TODO: 实现 HuggingFace 嵌入
    throw new Error('HuggingFace embedding not implemented yet.');
  }

  /**
   * 批量向量化文本
   * @param {string[]} texts - 要向量化的文本数组
   * @param {string} userId - 用户ID
   * @returns {Promise<number[][]>} 向量嵌入数组的数组
   */
  async embedTexts(texts, userId) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('Texts must be a non-empty array');
    }

    try {
      // 批量处理，避免一次性处理太多
      const batchSize = 10;
      const results = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchPromises = batch.map(text => this.embedText(text, userId));
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      return results;
    } catch (error) {
      logger.error('Error embedding texts:', error);
      throw error;
    }
  }
}

module.exports = EmbeddingService;

