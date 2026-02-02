const { logger } = require('@aipyq/data-schemas');
const { RAGService } = require('~/server/services/RAG');
// 从编译后的包中导入，或使用本地 JavaScript 文件
let KnowledgeType;
try {
  KnowledgeType = require('@aipyq/data-schemas/schema/knowledgeBase').KnowledgeType;
} catch (e) {
  try {
    KnowledgeType = require('../../../packages/data-schemas/src/schema/knowledgeBase').KnowledgeType;
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

const ragService = new RAGService();

/**
 * RAG 查询控制器
 * POST /api/rag/query
 */
const query = async (req, res) => {
  try {
    const { query, options = {} } = req.body;
    const userId = req.user.id;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: '查询文本不能为空',
      });
    }

    const result = await ragService.query({
      query,
      userId,
      options: {
        types: options.types,
        fileIds: options.fileIds,
        entityId: options.entityId,
        topK: options.topK || 10,
        useReranking: options.useReranking !== false, // 默认启用
        enhancedReranking: options.enhancedReranking === true,
      },
    });

    res.json(result);
  } catch (error) {
    logger.error('[RAGController] 查询失败:', error);
    logger.error('[RAGController] 错误堆栈:', error.stack);
    res.status(500).json({
      error: 'RAG查询失败',
      message: error.message || '未知错误',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * 添加知识条目控制器
 * POST /api/rag/knowledge
 */
const addKnowledge = async (req, res) => {
  try {
    const { type, data } = req.body;
    const userId = req.user.id;

    if (!type || !Object.values(KnowledgeType).includes(type)) {
      return res.status(400).json({
        error: '无效的知识类型',
        validTypes: Object.values(KnowledgeType),
      });
    }

    if (!data) {
      return res.status(400).json({
        error: '知识数据不能为空',
      });
    }

    const result = await ragService.addKnowledge({
      userId,
      type,
      data,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('[RAGController] 添加知识失败:', error);
    res.status(500).json({
      error: '添加知识失败',
      message: error.message,
    });
  }
};

/**
 * 批量添加知识条目控制器
 * POST /api/rag/knowledge/batch
 */
const addKnowledgeBatch = async (req, res) => {
  try {
    const { entries } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        error: '知识条目数组不能为空',
      });
    }

    const results = await ragService.addKnowledgeBatch({
      userId,
      entries,
    });

    res.json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    logger.error('[RAGController] 批量添加知识失败:', error);
    res.status(500).json({
      error: '批量添加知识失败',
      message: error.message,
    });
  }
};

/**
 * 获取知识条目列表控制器
 * GET /api/rag/knowledge
 * 按用户ID隔离，只返回当前用户的知识条目
 */
const getKnowledgeList = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      type,
      entityId,
      includeChildren = 'false',
      limit = 100,
      skip = 0,
    } = req.query;

    const filters = {};
    if (type) {
      filters.type = type;
    }
    if (entityId) {
      filters.entityId = entityId;
    }

    const results = await ragService.getKnowledgeList({
      userId: userId, // 传递userId，实现用户隔离
      filters: {
        ...filters,
        includeChildren: includeChildren === 'true',
        limit: parseInt(limit, 10),
        skip: parseInt(skip, 10),
      },
    });

    res.json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    logger.error('[RAGController] 获取知识列表失败:', error);
    res.status(500).json({
      error: '获取知识列表失败',
      message: error.message,
    });
  }
};

/**
 * 更新知识条目控制器
 * PUT /api/rag/knowledge/:id
 */
const updateKnowledge = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, data } = req.body;
    const userId = req.user.id;

    if (!id) {
      return res.status(400).json({
        error: '知识条目ID不能为空',
      });
    }

    if (!type || !Object.values(KnowledgeType).includes(type)) {
      return res.status(400).json({
        error: '无效的知识类型',
        validTypes: Object.values(KnowledgeType),
      });
    }

    if (!data) {
      return res.status(400).json({
        error: '更新数据不能为空',
      });
    }

    // 只支持更新 QA对、同义词、业务知识
    const allowedTypes = [KnowledgeType.QA_PAIR, KnowledgeType.SYNONYM, KnowledgeType.BUSINESS_KNOWLEDGE];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        error: '不支持更新该类型的知识条目',
        allowedTypes,
      });
    }

    const result = await ragService.updateKnowledge({
      entryId: id,
      userId,
      type,
      data,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('[RAGController] 更新知识失败:', error);
    res.status(500).json({
      error: '更新知识失败',
      message: error.message,
    });
  }
};

/**
 * 删除知识条目控制器
 * DELETE /api/rag/knowledge/:id
 */
const deleteKnowledge = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
      return res.status(400).json({
        error: '知识条目ID不能为空',
      });
    }

    const success = await ragService.deleteKnowledge({
      entryId: id,
      userId,
    });

    if (success) {
      res.json({
        success: true,
        message: '知识条目已删除',
      });
    } else {
      res.status(404).json({
        error: '知识条目不存在或无权删除',
      });
    }
  } catch (error) {
    logger.error('[RAGController] 删除知识失败:', error);
    res.status(500).json({
      error: '删除知识失败',
      message: error.message,
    });
  }
};

module.exports = {
  query,
  addKnowledge,
  addKnowledgeBatch,
  getKnowledgeList,
  updateKnowledge,
  deleteKnowledge,
};

