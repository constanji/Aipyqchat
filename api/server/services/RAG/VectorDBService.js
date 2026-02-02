const { logger } = require('@aipyq/data-schemas');

/**
 * 向量数据库服务
 * 按照 DAT 系统架构，为每种知识类型创建独立的存储表
 * 直接连接 PostgreSQL + pgvector 数据库存储和检索向量
 */

// Embedding 模型维度配置
// bge-small-zh-v1.5 模型输出 512 维向量
const EMBEDDING_DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '512', 10);
/**
 * 检测是否在 Docker 容器内运行
 */
function isRunningInDocker() {
  try {
    const fs = require('fs');
    return fs.existsSync('/.dockerenv') || 
           (fs.existsSync('/proc/self/cgroup') && fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker'));
  } catch (error) {
    return false;
  }
}

class VectorDBService {
  constructor() {
    this.pool = null;
    this.initialized = false;
    this.tablesInitialized = false; // 标记表是否已初始化
    
    // 从环境变量或配置获取连接信息（优先级：VECTOR_DB_* > POSTGRES_* > 默认值）
    const envHost = process.env.VECTOR_DB_HOST || process.env.DB_HOST;
    const envPort = process.env.VECTOR_DB_PORT || process.env.DB_PORT;
    const envDatabase = process.env.VECTOR_DB_NAME || process.env.POSTGRES_DB;
    const envUser = process.env.VECTOR_DB_USER || process.env.POSTGRES_USER;
    const envPassword = process.env.VECTOR_DB_PASSWORD || process.env.POSTGRES_PASSWORD;
    
    // 如果环境变量未设置，根据运行环境设置默认值
    let defaultHost = 'vectordb';
    let defaultPort = 5432;
    let defaultDatabase = 'mydatabase';
    let defaultUser = 'myuser';
    let defaultPassword = 'mypassword';
    
    if (!envHost && !envPort && !envDatabase && !envUser && !envPassword) {
      // 只有在所有环境变量都未设置时才使用默认值
      if (!isRunningInDocker()) {
        // 在本地开发环境：使用 localhost 和映射的端口
        defaultHost = 'localhost';
        defaultPort = 5234; // 本地开发使用映射端口 5234
        defaultDatabase = 'Chizhou';
        defaultUser = 'Chizhou';
        defaultPassword = 'Chizhou';
        logger.debug('[VectorDBService] 检测到本地开发环境，使用默认配置: localhost:5234/Chizhou');
      } else {
        // 在 Docker 容器内：使用容器网络内的主机名
        defaultHost = 'vectordb';
        defaultPort = 5432;
        defaultDatabase = 'Chizhou';
        defaultUser = 'Chizhou';
        defaultPassword = 'Chizhou';
        logger.debug('[VectorDBService] 检测到 Docker 容器环境，使用默认配置: vectordb:5432/Chizhou');
      }
    }
    
    this.config = {
      host: envHost || defaultHost,
      port: parseInt(envPort || defaultPort.toString(), 10),
      database: envDatabase || defaultDatabase,
      user: envUser || defaultUser,
      password: envPassword || defaultPassword,
      embeddingDimension: EMBEDDING_DIMENSION, // 向量维度
    };
    
  }

  /**
   * 初始化数据库连接
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // 动态加载 pg 库
      let pg;
      try {
        pg = require('pg');
      } catch (error) {
        logger.error('pg (node-postgres) not found. Please install it: npm install pg');
        throw new Error('pg package is required for vector database connection. Install it with: npm install pg');
      }

      // 创建连接池
      const { Pool } = pg;
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        max: 20, // 最大连接数
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // 增加到 10 秒，给数据库更多时间准备
      });

      // 添加连接错误处理
      this.pool.on('error', (err) => {
        logger.error('[VectorDBService] Unexpected error on idle client:', err);
        this.initialized = false; // 标记为未初始化，下次会重试
      });

      // 测试连接（带重试机制）
      let retries = 3;
      let lastError;
      while (retries > 0) {
        try {
          const client = await this.pool.connect();
          await client.query('SELECT 1');
          client.release();
          break; // 连接成功，跳出重试循环
        } catch (error) {
          lastError = error;
          retries--;
          if (retries > 0) {
            logger.warn(`[VectorDBService] 连接失败，${retries} 次重试剩余... 错误: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 等待 2 秒后重试
          }
        }
      }

      if (retries === 0 && lastError) {
        const errorDetails = {
          message: lastError.message,
          code: lastError.code,
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.user,
        };
        logger.error('[VectorDBService] 连接失败详情:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`无法连接到向量数据库 ${this.config.host}:${this.config.port}/${this.config.database}。错误: ${lastError.message} (代码: ${lastError.code || 'N/A'})`);
      }

      // 确保 pgvector 扩展已启用
      await this.ensureExtension();

      // 确保表结构存在（只在首次初始化时创建）
      if (!this.tablesInitialized) {
        await this.ensureTables();
        this.tablesInitialized = true;
      }

      this.initialized = true;
      logger.info('[VectorDBService] Vector database connection initialized successfully');
    } catch (error) {
      logger.error('[VectorDBService] Failed to initialize vector database:', error);
      logger.error(`[VectorDBService] 连接配置: ${this.config.host}:${this.config.port}/${this.config.database}, user: ${this.config.user}`);
      // 不立即抛出错误，允许后续重试
      this.initialized = false;
      throw error;
    }
  }

  /**
   * 确保 pgvector 扩展已启用
   */
  async ensureExtension() {
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      logger.debug('[VectorDBService] pgvector extension enabled');
    } catch (error) {
      logger.warn('[VectorDBService] Failed to enable pgvector extension (may already be enabled):', error.message);
    }
  }

  /**
   * 确保表结构存在
   * 按照 DAT 系统架构，为每种知识类型创建独立的表（独立存储空间）
   * 优化：先检查表是否存在，只创建缺失的表
   */
  async ensureTables() {
    try {
      const embeddingDim = this.config.embeddingDimension;
      
      // 先检查哪些表已存在
      const expectedTables = [
        'file_vectors',
      ];
      
      const tablesResult = await this.pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = ANY($1::text[])
      `, [expectedTables]);
      
      const existingTables = new Set(tablesResult.rows.map(r => r.table_name));
      const missingTables = expectedTables.filter(t => !existingTables.has(t));
      
      if (missingTables.length === 0) {
        logger.debug('[VectorDBService] 所有表已存在，跳过创建');
        return;
      }
      
      logger.info(`[VectorDBService] 开始创建缺失的表结构（${missingTables.length} 个），向量维度: ${embeddingDim}`);

      // 创建文件向量表（兼容现有文件向量化）
      if (missingTables.includes('file_vectors')) {
        await this.pool.query(`
        CREATE TABLE IF NOT EXISTS file_vectors (
          id SERIAL PRIMARY KEY,
          file_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255),
          entity_id VARCHAR(255),
          chunk_index INTEGER DEFAULT 0,
          content TEXT NOT NULL,
          embedding vector(${embeddingDim}),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      }

      // 创建文件向量索引（使用 IF NOT EXISTS，可以安全地重复执行）
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_file_vectors_file_id 
        ON file_vectors(file_id)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_file_vectors_embedding_hnsw 
        ON file_vectors 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);

      if (missingTables.length > 0) {
        logger.info(`[VectorDBService] 表结构初始化完成: 创建了 ${missingTables.length} 个缺失的表 (${missingTables.join(', ')})`);
        
        // 验证新创建的表是否真的创建成功
        const verifyResult = await this.pool.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ANY($1::text[])
        `, [missingTables]);
        const createdTables = verifyResult.rows.map(r => r.table_name);
        
        if (createdTables.length !== missingTables.length) {
          const failedTables = missingTables.filter(t => !createdTables.includes(t));
          logger.warn(`[VectorDBService] 部分表创建失败: ${failedTables.join(', ')}`);
        } else {
          logger.debug(`[VectorDBService] 验证: 所有缺失的表都已成功创建`);
        }
      } else {
        logger.debug(`[VectorDBService] 所有表已存在，无需创建`);
      }
    } catch (error) {
      logger.error('[VectorDBService] Failed to create tables:', error);
      logger.error('[VectorDBService] 错误堆栈:', error.stack);
      throw error;
    }
  }

  /**
   * 获取表名（根据知识类型）
   * 按照 DAT 系统架构，每种类型对应独立的表
   * @param {string} type - 知识类型
   * @returns {string} 表名
   */
  getTableName(type) {
    const tableMap = {
      file_vectors: "file_vectors",
    };
    return tableMap[type] || null;
  }

  /**
   * 存储知识条目向量
   * 按照 DAT 系统架构，每种类型存储到对应的独立表
   * 存储流程：JSON序列化 → 向量化 → 存储到对应的独立表
   * @param {Object} params
   * @param {string} params.knowledgeEntryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @param {string} params.type - 知识类型
   * @param {string} params.content - 内容（JSON序列化）
   * @param {number[]} params.embedding - 向量嵌入
   * @param {Object} params.metadata - 元数据
   * @returns {Promise<boolean>} 是否成功
   */
  async storeKnowledgeVector({ knowledgeEntryId, userId, type, content, embedding, metadata = {} }) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // 验证 embedding 维度
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Embedding must be a non-empty array');
      }

      const actualDimension = embedding.length;
      const expectedDimension = this.config.embeddingDimension;
      
      if (actualDimension !== expectedDimension) {
        const errorMsg = `Embedding dimension mismatch: got ${actualDimension}, expected ${expectedDimension}. ` +
          `Please check your embedding model output dimension and VectorDB table schema. ` +
          `You can configure EMBEDDING_DIMENSION environment variable to match your model.`;
        logger.error(`[VectorDBService] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // 根据类型获取对应的表名
      const tableName = this.getTableName(type);
      if (!tableName) {
        throw new Error(`不支持的知识类型: ${type}`);
      }

      // 将数组转换为 pgvector 格式
      const embeddingStr = `[${embedding.join(',')}]`;

      // 存储到对应的独立表（按照 DAT 架构）
      await this.pool.query(
        `INSERT INTO ${tableName} 
         (knowledge_entry_id, user_id, content, embedding, metadata, updated_at)
         VALUES ($1, $2, $3, $4::vector, $5::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (knowledge_entry_id) 
         DO UPDATE SET 
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding::vector,
           metadata = EXCLUDED.metadata::jsonb,
           updated_at = CURRENT_TIMESTAMP`,
        [knowledgeEntryId, userId, content, embeddingStr, JSON.stringify(metadata, (key, value) => {
          // 移除 null 字符（\u0000），PostgreSQL JSONB 不接受
          if (typeof value === 'string') {
            return value.replace(/\u0000/g, '');
          }
          return value;
        })]
      );

      logger.debug(`[VectorDBService] Stored vector for ${type} in table ${tableName}: ${knowledgeEntryId}`);
      return true;
    } catch (error) {
      logger.error('[VectorDBService] Failed to store knowledge vector:', error);
      throw error;
    }
  }

  /**
   * 更新知识向量（实际上使用 storeKnowledgeVector，因为它已经支持 ON CONFLICT DO UPDATE）
   * @param {Object} params
   * @param {string} params.knowledgeEntryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @param {string} params.type - 知识类型
   * @param {string} params.content - 内容（JSON序列化）
   * @param {number[]} params.embedding - 向量嵌入
   * @param {Object} params.metadata - 元数据
   * @returns {Promise<boolean>} 是否成功
   */
  async updateKnowledgeVector({ knowledgeEntryId, userId, type, content, embedding, metadata = {} }) {
    // storeKnowledgeVector 已经支持 ON CONFLICT DO UPDATE，所以直接调用它
    return await this.storeKnowledgeVector({
      knowledgeEntryId,
      userId,
      type,
      content,
      embedding,
      metadata,
    });
  }

  /**
   * 从单个表中搜索相似向量
   * 按照 DAT 系统架构，每个类型在独立的表中搜索
 
   * 支持entityId数据源隔离
   * @param {Object} params
   * @param {string} params.tableName - 表名
   * @param {string} params.queryEmbedding - 查询向量
   * @param {string} params.type - 知识类型
   * @param {string} [params.entityId] - 实体ID（数据源隔离，可选）
   * @param {number} params.topK - 返回前K个结果
   * @param {number} params.minScore - 最小相似度分数
   * @returns {Promise<Array>} 搜索结果数组
   */
  async searchInTable({ tableName, queryEmbedding, type, entityId, topK, minScore }) {
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // 构建查询条件：支持entityId数据源隔离
    let whereClause = 'WHERE embedding IS NOT NULL\n        AND 1 - (embedding <=> $1::vector) >= $2';
    const queryParams = [embeddingStr, minScore];

    if (entityId) {
      // 确保entityId是字符串格式（PostgreSQL JSON字段比较需要精确匹配）
      let entityIdStr = typeof entityId === 'string' ? entityId : String(entityId);
      
      // 移除可能的JSON引号（如果entityId被错误地JSON.stringify了）
      // 例如："696e11c6c8717a92aee4e699" -> 696e11c6c8717a92aee4e699
      if (entityIdStr.startsWith('"') && entityIdStr.endsWith('"')) {
        entityIdStr = entityIdStr.slice(1, -1);
        logger.warn(`[VectorDBService] searchInTable - 检测到entityId包含引号，已移除: 原始="${entityId}", 处理后="${entityIdStr}"`);
      }
      
      // 诊断：先检查表中是否有匹配的entity_id记录
      try {
        const countQuery = `SELECT COUNT(*) as count FROM ${tableName} WHERE metadata->>'entity_id' = $1`;
        const countResult = await this.pool.query(countQuery, [entityIdStr]);
        const totalCount = parseInt(countResult.rows[0]?.count || '0', 10);
        logger.info(`[VectorDBService] searchInTable - 诊断查询: 表 ${tableName} 中entity_id="${entityIdStr}"的总记录数: ${totalCount}`);
        
        if (totalCount === 0) {
          // 检查表中实际存储的entity_id格式
          const sampleQuery = `SELECT DISTINCT metadata->>'entity_id' as entity_id FROM ${tableName} LIMIT 3`;
          const sampleResult = await this.pool.query(sampleQuery);
          const sampleEntityIds = sampleResult.rows.map(r => r.entity_id).filter(Boolean);
          if (sampleEntityIds.length > 0) {
            logger.warn(`[VectorDBService] searchInTable - 表中实际存储的entity_id样本: ${JSON.stringify(sampleEntityIds)}`);
            logger.warn(`[VectorDBService] searchInTable - 查询的entity_id: "${entityIdStr}"`);
          } else {
            logger.warn(`[VectorDBService] searchInTable - 表中没有entity_id字段的记录`);
          }
        }
      } catch (diagError) {
        logger.warn(`[VectorDBService] searchInTable - 诊断查询失败:`, diagError.message);
      }
      
      // 使用metadata->>'entity_id'进行文本比较（这是最直接的方式）
      whereClause += '\n        AND metadata->>\'entity_id\' = $3';
      queryParams.push(entityIdStr);
      
      logger.info(`[VectorDBService] searchInTable - 使用entityId过滤: "${entityIdStr}" (原始类型: ${typeof entityId}, 长度: ${entityIdStr.length}, 表: ${tableName})`);
    } else {
      logger.info(`[VectorDBService] searchInTable - 未使用entityId过滤 (表: ${tableName})`);
    }
    
    const limitParamIndex = queryParams.length + 1;
    const query = `
      SELECT
        knowledge_entry_id,
        user_id,
        content,
        metadata,
        1 - (embedding <=> $1::vector) as similarity
      FROM ${tableName}
      ${whereClause}
      ORDER BY embedding <=> $1::vector
      LIMIT $${limitParamIndex}
    `;

    queryParams.push(topK);

    logger.debug(`[VectorDBService] searchInTable - 执行SQL查询 (表: ${tableName}):`, {
      queryPreview: query.substring(0, 200) + '...',
      paramCount: queryParams.length,
      entityId: entityId ? (typeof entityId === 'string' ? entityId : String(entityId)) : null,
    });

    const result = await this.pool.query(query, queryParams);

    logger.info(`[VectorDBService] searchInTable - 查询完成 (表: ${tableName}): 返回 ${result.rows.length} 行 (minScore: ${minScore})`);
    
    // 如果返回0个结果，尝试不设置minScore限制看看有多少记录
    if (result.rows.length === 0 && entityId) {
      try {
        const testQuery = `
          SELECT 
            knowledge_entry_id,
            1 - (embedding <=> $1::vector) as similarity
          FROM ${tableName}
          WHERE embedding IS NOT NULL
            AND metadata->>'entity_id' = $2
          ORDER BY embedding <=> $1::vector
          LIMIT 5
        `;
        const testResult = await this.pool.query(testQuery, [embeddingStr, typeof entityId === 'string' ? entityId : String(entityId)]);
        if (testResult.rows.length > 0) {
          const maxSimilarity = Math.max(...testResult.rows.map(r => parseFloat(r.similarity)));
          logger.warn(`[VectorDBService] searchInTable - 未设置minScore限制时找到 ${testResult.rows.length} 条记录，最高相似度: ${maxSimilarity.toFixed(4)} (minScore要求: ${minScore})`);
        }
      } catch (testError) {
        logger.debug(`[VectorDBService] searchInTable - 测试查询失败:`, testError.message);
      }
    }

    return result.rows.map(row => ({
      knowledgeEntryId: row.knowledge_entry_id,
      userId: row.user_id,
      type: type, // 添加类型信息
      content: row.content,
      metadata: row.metadata,
      score: parseFloat(row.similarity),
      similarity: parseFloat(row.similarity),
    }));
  }

  /**
   * 从file_vectors表中检索文件chunk
   * 支持两种模式：
   * 1. 通过file_id过滤：只检索指定文件的chunk（用于业务知识上传文档）
   * 2. 直接相似度搜索：在所有文件的chunk中搜索（用于混合检索）
   * 
   * @param {Object} params
   * @param {number[]} params.queryEmbedding - 查询向量
   * @param {string} [params.fileId] - 文件ID（可选，如果提供则只检索该文件的chunk）
   * @param {string} [params.entityId] - 实体ID（数据源隔离，可选）
   * @param {number} params.topK - 返回前K个结果
   * @param {number} params.minScore - 最小相似度分数
   * @returns {Promise<Array>} 搜索结果数组
   */
  async searchFileVectors({ queryEmbedding, fileId, entityId, topK = 10, minScore = 0.5 }) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      
      // 构建查询条件
      let whereClause = 'WHERE embedding IS NOT NULL\n        AND 1 - (embedding <=> $1::vector) >= $2';
      const queryParams = [embeddingStr, minScore];
      let paramIndex = 3;

      // 如果指定了file_id，只检索该文件的chunk
      if (fileId) {
        whereClause += `\n        AND file_id = $${paramIndex}`;
        queryParams.push(fileId);
        paramIndex++;
      }

      // 如果指定了entity_id，进行数据源隔离
      if (entityId) {
        whereClause += `\n        AND metadata->>'entity_id' = $${paramIndex}`;
        queryParams.push(entityId);
        paramIndex++;
      }

      const query = `
        SELECT 
          file_id,
          chunk_index,
          content,
          metadata,
          1 - (embedding <=> $1::vector) as similarity
        FROM file_vectors
        ${whereClause}
        ORDER BY embedding <=> $1::vector
        LIMIT $${paramIndex}
      `;

      queryParams.push(topK);

      const result = await this.pool.query(query, queryParams);

      return result.rows.map(row => ({
        fileId: row.file_id,
        chunkIndex: row.chunk_index,
        content: row.content,
        metadata: row.metadata || {},
        score: parseFloat(row.similarity),
        similarity: parseFloat(row.similarity),
      }));
    } catch (error) {
      logger.error('[VectorDBService] 文件向量检索失败:', error);
      throw error;
    }
  }

  /**
   * 相似度搜索
   * 按照 DAT 系统架构，从对应的独立表中搜索
   * 查找流程：问题向量化 → 在对应的独立表中搜索 → 返回结果
 
   * 支持entityId数据源隔离
   * @param {Object} params
   * @param {number[]} params.queryEmbedding - 查询向量
   * @param {string[]} params.types - 知识类型过滤（如果为空，搜索所有类型）
   * @param {string} [params.entityId] - 实体ID（数据源隔离，可选）
   * @param {number} params.topK - 返回前K个结果（每个类型）
   * @param {number} params.minScore - 最小相似度分数
   * @returns {Promise<Array>} 搜索结果数组
   */
  async searchSimilar({ queryEmbedding, types, entityId, topK = 10, minScore = 0.5 }) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const allTypes = ["file_vectors"];
      const searchTypes = types && types.length > 0 ? types : allTypes;
      const isolationInfo = entityId ? `, entityId: ${entityId} (数据源隔离, 类型: ${typeof entityId})` : ' (无数据源隔离)';
      logger.info(`[VectorDBService] 开始向量相似度搜索 (类型数: ${searchTypes.length}, topK: ${topK}, minScore: ${minScore})${isolationInfo}`);

      // 按照 DAT 架构，从每个类型的独立表中搜索
      const searchPromises = searchTypes.map(async (type) => {
        const tableName = this.getTableName(type);
        if (!tableName) {
          logger.warn(`[VectorDBService] 未知的知识类型: ${type}`);
          return [];
        }

        try {
          return await this.searchInTable({
            tableName,
            queryEmbedding,
            type,
            entityId, // 传递entityId进行数据源隔离
            topK, // 每个类型返回 topK 个结果
            minScore,
          });
        } catch (error) {
          logger.warn(`[VectorDBService] 从表 ${tableName} 搜索失败:`, error.message);
          return [];
        }
      });

      // 等待所有搜索完成
      const resultsArrays = await Promise.all(searchPromises);
      const allResults = resultsArrays.flat();

      // 按相似度分数排序，返回前 topK 个结果
      const sortedResults = allResults
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      logger.info(`[VectorDBService] 从 ${searchTypes.length} 个独立表中完成向量相似度搜索，返回 ${sortedResults.length} 个结果 (搜索类型: ${searchTypes.join(', ')})${isolationInfo}`);
      logger.debug(`[VectorDBService] Found ${sortedResults.length} similar vectors from ${searchTypes.length} independent tables (DAT architecture, no user isolation${entityId ? ', entity isolation enabled' : ''})`);
      return sortedResults;
    } catch (error) {
      logger.error('[VectorDBService] Failed to search similar vectors:', error);
      throw error;
    }
  }

  /**
   * 删除知识条目向量
   * 按照 DAT 系统架构，从对应的独立表中删除
   * @param {string} knowledgeEntryId - 知识条目ID
   * @param {string} type - 知识类型（可选，如果不提供则从所有表中删除）
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteKnowledgeVector(knowledgeEntryId, type = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (type) {
        // 从指定类型的表中删除
        const tableName = this.getTableName(type);
        if (!tableName) {
          throw new Error(`不支持的知识类型: ${type}`);
        }

        const result = await this.pool.query(
          `DELETE FROM ${tableName} WHERE knowledge_entry_id = $1`,
          [knowledgeEntryId]
        );

        logger.debug(`[VectorDBService] Deleted vector for ${type} from ${tableName}: ${knowledgeEntryId}`);
        return result.rowCount > 0;
      } else {
        // 从所有表中删除（用于兼容性）
        const allTypes = ["file_vectors"];
        let deleted = false;

        for (const t of allTypes) {
          const tableName = this.getTableName(t);
          if (tableName) {
            const result = await this.pool.query(
              `DELETE FROM ${tableName} WHERE knowledge_entry_id = $1`,
              [knowledgeEntryId]
            );
            if (result.rowCount > 0) {
              deleted = true;
              logger.debug(`[VectorDBService] Deleted vector from ${tableName}: ${knowledgeEntryId}`);
            }
          }
        }

        return deleted;
      }
    } catch (error) {
      logger.error('[VectorDBService] Failed to delete knowledge vector:', error);
      throw error;
    }
  }

  /**
   * 存储文件向量
   * 将文件内容分块后向量化并存储到 file_vectors 表
   * 
   * @param {Object} params
   * @param {string} params.fileId - 文件ID
   * @param {string} params.userId - 用户ID（用于数据隔离）
   * @param {string} [params.entityId] - 实体ID（数据源隔离，可选）
   * @param {Array<{text: string, metadata: Object}>} params.chunks - 文本块数组
   * @param {number[]} params.embeddings - 每个块的向量嵌入数组
   * @returns {Promise<boolean>} 是否成功
   */
  async storeFileVectors({ fileId, userId, entityId, chunks, embeddings }) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (!chunks || chunks.length === 0) {
        logger.warn('[VectorDBService] 没有文本块需要存储');
        return false;
      }

      if (chunks.length !== embeddings.length) {
        throw new Error(`文本块数量(${chunks.length})与向量数量(${embeddings.length})不匹配`);
      }

      // 先删除该文件的旧向量（如果存在）
      await this.pool.query(
        'DELETE FROM file_vectors WHERE file_id = $1',
        [fileId]
      );

      // 分批插入文件向量，避免同时创建大量 Promise 导致内存峰值
      // 对于大量 chunks，分批执行可以显著减少内存占用
      const INSERT_BATCH_SIZE = 20; // 每批插入20个向量
      
      for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
        const batchEnd = Math.min(i + INSERT_BATCH_SIZE, chunks.length);
        const batchPromises = [];
        
        for (let j = i; j < batchEnd; j++) {
          const chunk = chunks[j];
          const embedding = embeddings[j];
          
          if (!embedding || !Array.isArray(embedding)) {
            logger.warn(`[VectorDBService] 跳过无效的向量: chunk ${j}`);
            continue;
          }

          const actualDimension = embedding.length;
          const expectedDimension = this.config.embeddingDimension;
          
          if (actualDimension !== expectedDimension) {
            logger.warn(`[VectorDBService] 向量维度不匹配: chunk ${j}, got ${actualDimension}, expected ${expectedDimension}`);
            continue;
          }

          const embeddingStr = `[${embedding.join(',')}]`;
          // 修复文件名编码问题，并清理 metadata 中的所有字符串字段
          const { fixFilenameEncoding } = require('~/server/utils/files');
          let filename = chunk.metadata?.filename || chunk.metadata?.source?.split('/').pop() || '';
          filename = fixFilenameEncoding(filename);
          
          // 清理 metadata 中的所有字符串值，移除无效字符并修复编码
          const cleanMetadata = {};
          for (const [key, value] of Object.entries(chunk.metadata || {})) {
            if (typeof value === 'string') {
              // 修复编码并移除 null 字符
              cleanMetadata[key] = fixFilenameEncoding(value).replace(/\u0000/g, '');
            } else {
              cleanMetadata[key] = value;
            }
          }
          cleanMetadata.entity_id = entityId;
          cleanMetadata.filename = filename;
          
          // 将清理后的 metadata 转换为 JSON 字符串
          // PostgreSQL JSONB 需要有效的 JSON 字符串
          const metadataJson = JSON.stringify(cleanMetadata);
          
          batchPromises.push(
            this.pool.query(
              `INSERT INTO file_vectors 
               (file_id, user_id, entity_id, chunk_index, content, embedding, metadata)
               VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)`,
              [
                fileId,
                userId,
                entityId || null,
                j,
                chunk.text,
                embeddingStr,
                metadataJson,
              ]
            )
          );
        }
        
        // 等待当前批次完成
        await Promise.all(batchPromises);
        
        // 清理批次 Promise 数组
        batchPromises.length = 0;
        
        // 每处理一定数量的批次后，触发 GC（如果可用）
        if (global.gc && (i / INSERT_BATCH_SIZE) % 5 === 0) {
          global.gc();
        }
      }
      logger.info(`[VectorDBService] 成功存储 ${chunks.length} 个文件向量块到 file_vectors 表: fileId=${fileId}`);
      return true;
    } catch (error) {
      logger.error('[VectorDBService] 存储文件向量失败:', error);
      throw error;
    }
  }

  /**
   * 增量存储文件向量（不删除旧数据，用于分批处理）
   * @param {Object} params
   * @param {string} params.fileId - 文件ID
   * @param {string} params.userId - 用户ID
   * @param {string} [params.entityId] - 实体ID
   * @param {Array} params.chunks - 文本块数组
   * @param {Array} params.embeddings - 向量数组
   * @param {number} [params.startChunkIndex] - 起始chunk索引（用于分批处理）
   * @returns {Promise<boolean>} 是否成功
   */
  async storeFileVectorsIncremental({ fileId, userId, entityId, chunks, embeddings, startChunkIndex = 0 }) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (!chunks || chunks.length === 0) {
        logger.warn('[VectorDBService] 没有文本块需要存储（增量）');
        return false;
      }

      if (chunks.length !== embeddings.length) {
        throw new Error(`文本块数量(${chunks.length})与向量数量(${embeddings.length})不匹配`);
      }

      // 分批增量插入文件向量（不删除旧数据），避免同时创建大量 Promise
      const INSERT_BATCH_SIZE = 20; // 每批插入20个向量
      
      for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
        const batchEnd = Math.min(i + INSERT_BATCH_SIZE, chunks.length);
        const batchPromises = [];
        
        for (let j = i; j < batchEnd; j++) {
          const chunk = chunks[j];
          const globalIndex = startChunkIndex + j;
          const embedding = embeddings[j];
          
          if (!embedding || !Array.isArray(embedding)) {
            logger.warn(`[VectorDBService] 跳过无效的向量: chunk ${globalIndex}`);
            continue;
          }

          const actualDimension = embedding.length;
          const expectedDimension = this.config.embeddingDimension;
          
          if (actualDimension !== expectedDimension) {
            logger.warn(`[VectorDBService] 向量维度不匹配: chunk ${globalIndex}, got ${actualDimension}, expected ${expectedDimension}`);
            continue;
          }

          const embeddingStr = `[${embedding.join(',')}]`;
          // 修复文件名编码问题，并清理 metadata 中的所有字符串字段
          const { fixFilenameEncoding } = require('~/server/utils/files');
          let filename = chunk.metadata?.filename || chunk.metadata?.source?.split('/').pop() || '';
          filename = fixFilenameEncoding(filename);
          
          // 清理 metadata 中的所有字符串值，移除无效字符并修复编码
          const cleanMetadata = {};
          for (const [key, value] of Object.entries(chunk.metadata || {})) {
            if (typeof value === 'string') {
              // 修复编码并移除 null 字符
              cleanMetadata[key] = fixFilenameEncoding(value).replace(/\u0000/g, '');
            } else {
              cleanMetadata[key] = value;
            }
          }
          cleanMetadata.entity_id = entityId;
          cleanMetadata.filename = filename;
          
          // 将清理后的 metadata 转换为 JSON 字符串
          const metadataJson = JSON.stringify(cleanMetadata);
          
          batchPromises.push(
            this.pool.query(
              `INSERT INTO file_vectors 
               (file_id, user_id, entity_id, chunk_index, content, embedding, metadata)
               VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)`,
              [
                fileId,
                userId,
                entityId || null,
                globalIndex,
                chunk.text,
                embeddingStr,
                metadataJson,
              ]
            )
          );
        }
        
        // 等待当前批次完成
        await Promise.all(batchPromises);
        
        // 清理批次 Promise 数组
        batchPromises.length = 0;
        
        // 每处理一定数量的批次后，触发 GC（如果可用）
        if (global.gc && (i / INSERT_BATCH_SIZE) % 5 === 0) {
          global.gc();
        }
      }
      logger.info(`[VectorDBService] 成功增量存储 ${chunks.length} 个文件向量块到 file_vectors 表: fileId=${fileId}, startIndex=${startChunkIndex}`);
      return true;
    } catch (error) {
      logger.error('[VectorDBService] 增量存储文件向量失败:', error);
      throw error;
    }
  }

  /**
   * 删除文件向量
   * @param {string} fileId - 文件ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteFileVectors(fileId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await this.pool.query(
        'DELETE FROM file_vectors WHERE file_id = $1',
        [fileId]
      );
      logger.info(`[VectorDBService] 删除文件向量: fileId=${fileId}, 删除 ${result.rowCount} 条记录`);
      return result.rowCount > 0;
    } catch (error) {
      logger.error('[VectorDBService] 删除文件向量失败:', error);
      throw error;
    }
  }

  /**
   * 获取连接池（用于高级操作）
   * @returns {Object} pg Pool 实例
   */
  getPool() {
    if (!this.initialized) {
      throw new Error('VectorDBService not initialized');
    }
    return this.pool;
  }
}

module.exports = VectorDBService;
