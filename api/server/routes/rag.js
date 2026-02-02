const express = require('express');
const {
  requireJwtAuth,
  configMiddleware,
  checkBan,
} = require('~/server/middleware');
const ragController = require('~/server/controllers/RAGController');

const router = express.Router();

// 所有路由都需要 JWT 认证
router.use(requireJwtAuth);
router.use(configMiddleware);
router.use(checkBan);

/**
 * POST /api/rag/query
 * RAG 查询端点
 * 问题向量化 --> 语义模型/QA对/同义词/业务知识 向量检索 --> 重排优化
 */
router.post('/query', ragController.query);

/**
 * POST /api/rag/knowledge
 * 添加知识条目到知识库
 */
router.post('/knowledge', ragController.addKnowledge);

/**
 * POST /api/rag/knowledge/batch
 * 批量添加知识条目
 */
router.post('/knowledge/batch', ragController.addKnowledgeBatch);

/**
 * GET /api/rag/knowledge
 * 获取知识条目列表
 */
router.get('/knowledge', ragController.getKnowledgeList);

/**
 * PUT /api/rag/knowledge/:id
 * 更新知识条目
 */
router.put('/knowledge/:id', ragController.updateKnowledge);

/**
 * DELETE /api/rag/knowledge/:id
 * 删除知识条目
 */
router.delete('/knowledge/:id', ragController.deleteKnowledge);

module.exports = router;

