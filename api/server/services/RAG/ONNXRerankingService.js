const path = require('path');
const fs = require('fs');
const { logger } = require('@aipyq/data-schemas');

/**
 * ONNX 重排服务
 * 使用本地 ONNX 模型进行文档重排序
 * 使用 @xenova/transformers 库来处理 ONNX 模型
 */
class ONNXRerankingService {
  constructor() {
    // 使用符合 @xenova/transformers 期望的本地目录结构
    // 路径: resources/Xenova/ms-marco-MiniLM-L-6-v2/
    this.resourcesPath = path.join(__dirname, 'onnx', 'reranker', 'resources');
    this.modelPath = path.join(this.resourcesPath, 'Xenova', 'ms-marco-MiniLM-L-6-v2');
    this.pipeline = null;
    this.initialized = false;
  }

  /**
   * 初始化 ONNX 模型和 tokenizer
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // 检查模型文件是否存在（使用新的目录结构）
      const modelFile = path.join(this.modelPath, 'onnx', 'model_quantized.onnx');
      const tokenizerFile = path.join(this.modelPath, 'tokenizer.json');
      const configFile = path.join(this.modelPath, 'config.json');

      if (!fs.existsSync(modelFile)) {
        throw new Error(`ONNX reranker model not found at: ${modelFile}`);
      }

      if (!fs.existsSync(tokenizerFile)) {
        throw new Error(`Tokenizer not found at: ${tokenizerFile}`);
      }

      if (!fs.existsSync(configFile)) {
        throw new Error(`Config file not found at: ${configFile}`);
      }

      // 动态加载 @xenova/transformers
      let transformers;
      try {
        transformers = require('@xenova/transformers');
      } catch (error) {
        logger.error('@xenova/transformers not found. Please install it: npm install @xenova/transformers');
        throw new Error('@xenova/transformers is required for ONNX reranking. Install it with: npm install @xenova/transformers');
      }

      // 配置 @xenova/transformers 环境 - 强制离线模式
      // 使用 transformers 的 env API 来禁用远程模型加载
      const { env, pipeline } = transformers;
      
      // 保存原始配置
      const originalAllowRemoteModels = env.allowRemoteModels;
      const originalUseBrowserCache = env.useBrowserCache;
      const originalCacheDir = env.cacheDir;
      
      // 强制离线模式：禁用所有远程模型加载
      env.allowRemoteModels = false;
      env.useBrowserCache = false;
      
      // 设置缓存目录为我们的 resources 目录
      // transformers 会在 cacheDir/Xenova/ms-marco-MiniLM-L-6-v2/ 下查找模型
      env.cacheDir = path.resolve(this.resourcesPath);
      
      // 如果遇到 SSL 证书问题，允许使用不安全的连接（仅用于开发环境）
      const originalTLSReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      if (process.env.NODE_ENV === 'development' || process.env.ALLOW_INSECURE_SSL === 'true') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        logger.warn('[ONNXRerankingService] SSL verification disabled (development mode or ALLOW_INSECURE_SSL=true)');
      }
      
      // 拦截全局 fetch，阻止所有网络请求（仅在模型加载期间）
      const originalFetch = global.fetch;
      let fetchIntercepted = false;
      const resourcesPathResolved = path.resolve(this.resourcesPath);
      
      // 创建一个只允许本地文件访问的 fetch 拦截器
      global.fetch = function(...args) {
        const url = args[0];
        const urlString = typeof url === 'string' ? url : url?.toString() || '';
        
        // 如果是本地文件路径（file:// 或绝对路径），允许访问
        if (urlString.startsWith('file://') || 
            (urlString.startsWith('/') && !urlString.startsWith('http')) ||
            urlString.includes(resourcesPathResolved)) {
          return originalFetch.apply(this, args);
        }
        
        // 阻止所有 HTTP/HTTPS 网络请求
        if (urlString.startsWith('http://') || urlString.startsWith('https://')) {
          logger.warn(`[ONNXRerankingService] Blocked network request: ${urlString}`);
          return Promise.reject(new Error(`Network requests are disabled in offline mode. Attempted to fetch: ${urlString}`));
        }
        
        // 允许其他类型的请求（可能是本地文件系统操作）
        return originalFetch.apply(this, args);
      };
      
      fetchIntercepted = true;
      
      // 使用模型名称（不是绝对路径），transformers 会在 cacheDir 下查找
      const modelName = 'Xenova/ms-marco-MiniLM-L-6-v2';
      
      logger.info(`[ONNXRerankingService] Loading model: ${modelName}`);
      logger.info(`[ONNXRerankingService] Cache directory: ${env.cacheDir}`);
      logger.info(`[ONNXRerankingService] Allow remote models: ${env.allowRemoteModels}`);
      logger.info(`[ONNXRerankingService] Force offline mode - network requests intercepted`);

      try {
        // 创建文本分类 pipeline（用于重排序）
        // 重排序模型通常使用 cross-encoder 架构
        // 使用模型名称，transformers 会在 cacheDir/Xenova/ms-marco-MiniLM-L-6-v2/ 下查找
        // fetch 拦截器会阻止任何网络请求
        this.pipeline = await pipeline(
          'text-classification',
          modelName,
          {
            quantized: true,
            device: 'cpu', // 使用 CPU，也可以使用 'gpu' 如果有 GPU
          }
        );
      } catch (error) {
        logger.error(`[ONNXRerankingService] Failed to load model: ${error.message}`);
        throw new Error(`Failed to load ONNX reranker model: ${error.message}`);
      } finally {
        // 恢复全局 fetch
        if (fetchIntercepted) {
          global.fetch = originalFetch;
        }
        
        // 恢复 transformers 配置
        if (originalAllowRemoteModels !== undefined) {
          env.allowRemoteModels = originalAllowRemoteModels;
        } else {
          env.allowRemoteModels = true; // 恢复默认值
        }
        
        if (originalUseBrowserCache !== undefined) {
          env.useBrowserCache = originalUseBrowserCache;
        }
        
        if (originalCacheDir !== undefined) {
          env.cacheDir = originalCacheDir;
        } else {
          delete env.cacheDir;
        }
        
        // 恢复 SSL 验证（如果之前禁用了）
        if (originalTLSReject !== undefined) {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTLSReject;
        } else {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
      }

      this.initialized = true;
      logger.info('[ONNXRerankingService] ONNX reranker model initialized successfully');
    } catch (error) {
      logger.error('[ONNXRerankingService] Failed to initialize ONNX model:', error);
      throw error;
    }
  }

  /**
   * 对文档进行重排序
   * @param {string} query - 查询文本
   * @param {string[]} documents - 文档数组
   * @param {number} topK - 返回前K个结果
   * @returns {Promise<Array>} 重排后的结果数组，格式: [{ text: string, score: number }]
   */
  async rerank(query, documents, topK = 5) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!documents || documents.length === 0) {
      return [];
    }

    try {
      const results = [];

      // 对每个文档计算相关性分数
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        
        // 构建查询-文档对
        // Cross-encoder 模型需要将查询和文档组合在一起
        const inputText = `${query} [SEP] ${doc}`;

        // 使用 pipeline 进行分类/评分
        const output = await this.pipeline(inputText);

        // 提取分数
        let rawScore = 0;
        if (Array.isArray(output)) {
          // 如果有多个标签，取最高分的标签
          const maxScoreLabel = output.reduce((max, item) => 
            (item.score > max.score ? item : max)
          );
          rawScore = maxScoreLabel.score;
        } else if (typeof output === 'object' && 'score' in output) {
          rawScore = output.score;
        } else if (typeof output === 'number') {
          rawScore = output;
        } else if (output && output.data) {
          // 如果是 Tensor，取第一个值
          rawScore = Array.from(output.data)[0] || 0;
        }

        // 确保分数在0-1范围内
        // text-classification pipeline 通常返回0-1的概率分数，但需要验证
        let score = rawScore;
        if (score < 0) {
          // 如果分数是负数，可能是logits，需要sigmoid归一化
          score = 1 / (1 + Math.exp(-score));
        } else if (score > 1) {
          // 如果分数大于1，可能需要归一化
          // 使用min-max归一化（假设最大分数为10）
          score = Math.min(1, score / 10);
        }

        results.push({
          text: doc,
          score: score,
          rawScore: rawScore, // 保留原始分数用于调试
          index: i,
        });
      }

      // 按分数降序排序
      results.sort((a, b) => b.score - a.score);

      // 检查是否所有分数都相同（可能是模型输出问题）
      const scores = results.map(r => r.score);
      const allSame = scores.length > 0 && scores.every(s => Math.abs(s - scores[0]) < 0.0001);
      
      if (allSame && results.length > 1) {
        logger.warn(`[ONNXRerankingService] 警告：所有重排分数都相同 (${scores[0].toFixed(4)})，可能是模型输出问题`);
      }

      // 记录分数分布用于调试
      if (results.length > 0) {
        const minScore = Math.min(...scores);
        const maxScore = Math.max(...scores);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        logger.debug(`[ONNXRerankingService] 重排分数分布: 最低=${minScore.toFixed(4)}, 最高=${maxScore.toFixed(4)}, 平均=${avgScore.toFixed(4)}`);
      }

      // 返回前K个结果
      const topResults = results.slice(0, topK).map(item => ({
        text: item.text,
        score: item.score,
      }));

      logger.debug(`[ONNXRerankingService] Reranked ${documents.length} documents, returning top ${topResults.length}`);
      return topResults;
    } catch (error) {
      logger.error('[ONNXRerankingService] Error reranking documents:', error);
      // 失败时返回原始顺序
      return documents.slice(0, topK).map((doc, index) => ({
        text: doc,
        score: 1.0 - (index / documents.length), // 简单的降序分数
      }));
    }
  }
}

module.exports = ONNXRerankingService;

