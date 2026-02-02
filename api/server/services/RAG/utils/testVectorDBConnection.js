/**
 * 测试向量数据库连接脚本
 * 使用方法: 
 *   在宿主机上: node api/server/services/RAG/utils/testVectorDBConnection.js
 *   在 Docker 容器内: node server/services/RAG/utils/testVectorDBConnection.js
 * 
 * 环境变量（可选）:
 *   VECTOR_DB_HOST=localhost (宿主机) 或 vectordb (Docker 网络内)
 *   VECTOR_DB_PORT=5434 (宿主机) 或 5432 (Docker 网络内)
 */

const VectorDBService = require('../VectorDBService');

async function testConnection() {
  console.log('开始测试向量数据库连接...\n');

  // 检测运行环境：如果在宿主机上运行，使用 localhost 和 5434 端口
  // 如果在 Docker 容器内运行，使用 vectordb 和 5432 端口
  if (!process.env.VECTOR_DB_HOST && !process.env.DB_HOST) {
    // 尝试连接 localhost，如果失败则尝试 vectordb
    const testHost = 'localhost';
    const testPort = process.env.VECTOR_DB_PORT || process.env.DB_PORT || '5434';
    console.log(`检测到在宿主机上运行，使用 ${testHost}:${testPort}`);
    console.log('提示: 如果连接失败，请确保 Because-VectorDB 容器正在运行\n');
    process.env.VECTOR_DB_HOST = testHost;
    if (!process.env.VECTOR_DB_PORT && !process.env.DB_PORT) {
      process.env.VECTOR_DB_PORT = testPort;
    }
  }

  const vectorDBService = new VectorDBService();

  try {
    // 1. 测试连接
    console.log('1. 测试数据库连接...');
    await vectorDBService.initialize();
    console.log('✅ 数据库连接成功！\n');

    // 2. 测试表结构（按照 DAT 架构，应该有4个独立的知识表）
    console.log('2. 检查表结构...');
    const pool = vectorDBService.getPool();
    const expectedTables = [
      'semantic_model_vectors',
      'qa_pair_vectors',
      'synonym_vectors',
      'business_knowledge_vectors',
      'file_vectors',
    ];
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [expectedTables]);
    const foundTables = tablesResult.rows.map(r => r.table_name);
    console.log('✅ 找到表:', foundTables.join(', '));
    
    // 检查是否所有表都存在
    const missingTables = expectedTables.filter(t => !foundTables.includes(t));
    if (missingTables.length > 0) {
      console.log('⚠️  缺少表:', missingTables.join(', '));
    } else {
      console.log('✅ 所有必需的表都已创建\n');
    }

    // 3. 测试 pgvector 扩展
    console.log('3. 检查 pgvector 扩展...');
    const extResult = await pool.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname = 'vector'
    `);
    if (extResult.rows.length > 0) {
      console.log(`✅ pgvector 扩展已安装 (版本: ${extResult.rows[0].extversion})\n`);
    } else {
      console.log('⚠️  pgvector 扩展未找到\n');
    }

    // 4. 测试索引
    console.log('4. 检查索引...');
    const indexResult = await pool.query(`
      SELECT indexname, tablename
      FROM pg_indexes 
      WHERE tablename = ANY($1::text[])
      AND indexdef LIKE '%hnsw%'
      ORDER BY tablename, indexname
    `, [expectedTables]);
    console.log(`✅ 找到 ${indexResult.rows.length} 个 HNSW 索引:`);
    indexResult.rows.forEach(row => {
      console.log(`   - ${row.tablename}.${row.indexname}`);
    });
    console.log('');

    // 5. 测试向量存储和检索
    console.log('5. 测试向量存储和检索...');
    const testEmbedding = new Array(384).fill(0).map(() => Math.random() * 0.1);
    const testId = `test_${Date.now()}`;
    
    // 存储测试向量
    await vectorDBService.storeKnowledgeVector({
      knowledgeEntryId: testId,
      userId: 'test_user',
      type: 'qa_pair',
      content: '测试内容',
      embedding: testEmbedding,
      metadata: { test: true },
    });
    console.log('✅ 向量存储成功');

    // 检索测试向量
    const searchResults = await vectorDBService.searchSimilar({
      queryEmbedding: testEmbedding,
      userId: 'test_user',
      types: ['qa_pair'],
      topK: 1,
      minScore: 0.0,
    });
    console.log(`✅ 向量检索成功，找到 ${searchResults.length} 个结果`);

    // 清理测试数据
    await vectorDBService.deleteKnowledgeVector(testId, 'qa_pair');
    console.log('✅ 测试数据已清理\n');

    // 6. 显示数据库统计
    console.log('6. 数据库统计信息...');
    for (const tableName of expectedTables) {
      try {
        const statsResult = await pool.query(`
          SELECT 
            COUNT(*) as row_count,
            pg_size_pretty(pg_total_relation_size($1)) as total_size
          FROM ${tableName}
        `, [tableName]);
        if (statsResult.rows.length > 0) {
          const row = statsResult.rows[0];
          console.log(`   ${tableName}: ${row.row_count} 行, 大小: ${row.total_size}`);
        }
      } catch (error) {
        // 表可能不存在，忽略错误
      }
    }
    console.log('');

    console.log('✅ 所有测试通过！向量数据库连接正常。\n');

    // 显示连接信息
    console.log('连接信息:');
    console.log(`  Host: ${vectorDBService.config.host}`);
    console.log(`  Port: ${vectorDBService.config.port}`);
    console.log(`  Database: ${vectorDBService.config.database}`);
    console.log(`  User: ${vectorDBService.config.user}`);
    console.log('');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // 关闭连接池
    const pool = vectorDBService.getPool();
    await pool.end();
    console.log('连接已关闭');
  }
}

// 运行测试
if (require.main === module) {
  testConnection()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('测试出错:', error);
      process.exit(1);
    });
}

module.exports = testConnection;

