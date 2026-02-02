const path = require('path');
const fs = require('fs');
const { logger } = require('@aipyq/data-schemas');

/**
 * ONNX 嵌入服务
 * 使用本地 ONNX 模型进行文本向量化
 * 使用 @xenova/transformers 库来处理 ONNX 模型
 */
class ONNXEmbeddingService {
  constructor() {
    // 使用符合 @xenova/transformers 期望的本地目录结构
    // 路径: resources/Xenova/bge-small-zh-v1.5/
    this.resourcesPath = path.join(__dirname, 'onnx', 'embedding', 'resources');
    this.modelPath = path.join(this.resourcesPath, 'Xenova', 'bge-small-zh-v1.5');
    this.pipeline = null;
    this.initialized = false;
    this.initializing = false; // 添加初始化锁，防止并发初始化
    this.initPromise = null; // 保存初始化 Promise，供并发调用共享
  }

  /**
   * 初始化 ONNX 模型和 tokenizer
   */
  async initialize() {
    // 如果已经初始化，直接返回
    if (this.initialized) {
      return;
    }

    // 如果正在初始化，等待现有的初始化完成
    if (this.initializing && this.initPromise) {
      return await this.initPromise;
    }

    // 开始初始化，设置锁和 Promise
    this.initializing = true;
    this.initPromise = this._doInitialize();
    
    try {
      await this.initPromise;
    } finally {
      this.initializing = false;
    }
  }

  /**
   * 实际执行初始化的私有方法
   */
  async _doInitialize() {
    try {
      // 检查模型文件是否存在（使用新的目录结构）
      const modelFile = path.join(this.modelPath, 'onnx', 'model_quantized.onnx');
      const tokenizerFile = path.join(this.modelPath, 'tokenizer.json');
      const configFile = path.join(this.modelPath, 'config.json');

      if (!fs.existsSync(modelFile)) {
        throw new Error(`ONNX embedding model not found at: ${modelFile}`);
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
        // 先检查模块是否存在
        const modulePath = require.resolve('@xenova/transformers');
        logger.debug(`[ONNXEmbeddingService] Found @xenova/transformers at: ${modulePath}`);
        
        // 尝试加载模块
        transformers = require('@xenova/transformers');
        logger.debug('[ONNXEmbeddingService] Successfully loaded @xenova/transformers');
      } catch (error) {
        // 输出详细的错误信息以便调试
        logger.error('[ONNXEmbeddingService] Failed to load @xenova/transformers:', {
          message: error.message,
          code: error.code,
          stack: error.stack,
          cwd: process.cwd(),
          nodePath: process.env.NODE_PATH,
        });
        
        // 检查是否是模块未找到错误
        if (error.code === 'MODULE_NOT_FOUND') {
          logger.error('@xenova/transformers not found. Please install it: npm install @xenova/transformers');
          throw new Error('@xenova/transformers is required for ONNX embedding. Install it with: npm install @xenova/transformers');
        }
        
        // 其他错误也抛出
        throw new Error(`Failed to load @xenova/transformers: ${error.message}`);
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
      // transformers 会在 cacheDir/Xenova/bge-small-zh-v1.5/ 下查找模型
      env.cacheDir = path.resolve(this.resourcesPath);
      
      // 使用模型名称（不是绝对路径），transformers 会在 cacheDir 下查找
      const modelName = 'Xenova/bge-small-zh-v1.5';
      
      // 如果遇到 SSL 证书问题，允许使用不安全的连接（仅用于开发环境）
      const originalTLSReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      if (process.env.NODE_ENV === 'development' || process.env.ALLOW_INSECURE_SSL === 'true') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        logger.warn('[ONNXEmbeddingService] SSL verification disabled (development mode or ALLOW_INSECURE_SSL=true)');
      }
      
      // 拦截全局 fetch，但只拦截 transformers 相关的请求
      // 使用更精确的拦截策略，避免影响其他 LLM 请求
      const originalFetch = global.fetch;
      let fetchIntercepted = false;
      const resourcesPathResolved = path.resolve(this.resourcesPath);
      
      // 创建一个只拦截 transformers 相关请求的 fetch 拦截器
      // 只拦截可能来自 @xenova/transformers 的请求（huggingface.co, transformers 相关域名）
      global.fetch = function(...args) {
        const url = args[0];
        const urlString = typeof url === 'string' ? url : url?.toString() || '';
        
        // 如果是本地文件路径（file:// 或绝对路径），允许访问
        if (urlString.startsWith('file://') || 
            (urlString.startsWith('/') && !urlString.startsWith('http')) ||
            urlString.includes(resourcesPathResolved)) {
          return originalFetch.apply(this, args);
        }
        
        // 只拦截 transformers 相关的网络请求（huggingface.co 等）
        // 不拦截其他 LLM API 请求（如 deepseek.com, openai.com 等）
        const isTransformersRequest = 
          urlString.includes('huggingface.co') ||
          urlString.includes('transformers') ||
          urlString.includes('hf.co') ||
          (urlString.startsWith('https://') && urlString.match(/\/models\/|\/api\/models\//));
        
        if (isTransformersRequest) {
          logger.warn(`[ONNXEmbeddingService] Blocked transformers network request: ${urlString}`);
          return Promise.reject(new Error(`Transformers network requests are disabled in offline mode. Attempted to fetch: ${urlString}`));
        }
        
        // 允许其他所有 HTTP/HTTPS 请求（包括 LLM API 调用）
        return originalFetch.apply(this, args);
      };
      
      fetchIntercepted = true;
      
      logger.info(`[ONNXEmbeddingService] Loading model: ${modelName}`);
      logger.info(`[ONNXEmbeddingService] Cache directory: ${env.cacheDir}`);
      logger.info(`[ONNXEmbeddingService] Allow remote models: ${env.allowRemoteModels}`);
      logger.info(`[ONNXEmbeddingService] Force offline mode - network requests intercepted`);

      try {
        // 创建特征提取 pipeline（用于嵌入）
        // 使用模型名称，transformers 会在 cacheDir/Xenova/bge-small-zh-v1.5/ 下查找
        // fetch 拦截器会阻止任何网络请求
        this.pipeline = await pipeline(
          'feature-extraction',
          modelName,
          {
            quantized: true,
            device: 'cpu', // 使用 CPU，也可以使用 'gpu' 如果有 GPU
          }
        );
      } catch (error) {
        logger.error(`[ONNXEmbeddingService] Failed to load model: ${error.message}`);
        throw new Error(`Failed to load ONNX model: ${error.message}`);
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
      logger.info('[ONNXEmbeddingService] ONNX embedding model initialized successfully');
      return;
    } catch (error) {
      logger.error('[ONNXEmbeddingService] Failed to initialize ONNX model:', error);
      throw error;
    }
  }

  /**
   * 对文本进行向量嵌入
   * @param {string} text - 要向量化的文本
   * @returns {Promise<number[]>} 向量嵌入数组
   */
  async embedText(text) {
    // 确保初始化完成（处理并发情况）
    if (!this.initialized) {
      await this.initialize();
    }

    let output = null;
    try {
      // 使用 pipeline 进行特征提取
      output = await this.pipeline(text, {
        pooling: 'mean', // 使用 mean pooling
        normalize: true, // 归一化向量
      });

      // 提取嵌入向量
      let embedding;
      if (output && output.data) {
        // 如果是 Tensor 对象，立即转换为数组并释放 Tensor
        embedding = Array.from(output.data);
        // 如果 output 有 dispose 方法（某些 Tensor 库），调用它释放内存
        if (typeof output.dispose === 'function') {
          output.dispose();
        }
      } else if (Array.isArray(output)) {
        // 如果是数组，直接使用
        embedding = output;
      } else if (typeof output === 'object' && 'data' in output) {
        // 尝试获取 data 属性
        embedding = Array.from(output.data);
        // 如果 output 有 dispose 方法，调用它释放内存
        if (typeof output.dispose === 'function') {
          output.dispose();
        }
      } else {
        throw new Error('Unexpected output format from embedding model');
      }

      // 显式清理 output 引用（虽然作用域结束后会自动回收）
      output = null;
      
      // 对于大量向量化任务，定期触发GC有助于释放ONNX模型的中间缓存
      // 注意：频繁GC可能影响性能，但对于内存敏感的场景是必要的
      if (global.gc) {
        // 使用计数器，每10次向量化触发一次GC（避免过于频繁）
        if (!this._gcCounter) {
          this._gcCounter = 0;
        }
        this._gcCounter++;
        if (this._gcCounter % 10 === 0) {
          global.gc();
          logger.debug(`[ONNXEmbeddingService] Triggered GC after ${this._gcCounter} embeddings`);
        }
      }

      logger.debug(`[ONNXEmbeddingService] Generated embedding with dimension: ${embedding.length}`);
      return embedding;
    } catch (error) {
      // 确保在错误情况下也清理 output
      if (output && typeof output.dispose === 'function') {
        output.dispose();
      }
      output = null;
      logger.error('[ONNXEmbeddingService] Error embedding text:', error);
      throw new Error(`ONNX embedding failed: ${error.message}`);
    }
  }

  /**
   * 批量向量化文本
   * @param {string[]} texts - 要向量化的文本数组
   * @returns {Promise<number[][]>} 向量嵌入数组的数组
   */
  async embedTexts(texts) {
    const results = [];
    for (const text of texts) {
      const embedding = await this.embedText(text);
      results.push(embedding);
    }
    return results;
  }
}

module.exports = ONNXEmbeddingService;

