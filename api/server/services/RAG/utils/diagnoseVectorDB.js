/**
 * 向量数据库连接诊断脚本
 * 使用方法: node api/server/services/RAG/utils/diagnoseVectorDB.js
 */

const VectorDBService = require('../VectorDBService');
const { logger } = require('@aipyq/data-schemas');

async function diagnose() {
  console.log('\n========== 向量数据库连接诊断 ==========\n');

  // 1. 检查环境变量
  console.log('1. 检查环境变量:');
  console.log(`   VECTOR_DB_HOST: ${process.env.VECTOR_DB_HOST || '(未设置)'}`);
  console.log(`   VECTOR_DB_PORT: ${process.env.VECTOR_DB_PORT || '(未设置)'}`);
  console.log(`   VECTOR_DB_NAME: ${process.env.VECTOR_DB_NAME || '(未设置)'}`);
  console.log(`   VECTOR_DB_USER: ${process.env.VECTOR_DB_USER || '(未设置)'}`);
  console.log(`   VECTOR_DB_PASSWORD: ${process.env.VECTOR_DB_PASSWORD ? '***已设置***' : '(未设置)'}`);
  console.log(`   POSTGRES_DB: ${process.env.POSTGRES_DB || '(未设置)'}`);
  console.log(`   POSTGRES_USER: ${process.env.POSTGRES_USER || '(未设置)'}`);
  console.log(`   POSTGRES_PASSWORD: ${process.env.POSTGRES_PASSWORD ? '***已设置***' : '(未设置)'}\n`);

  // 2. 检查是否在 Docker 中
  const fs = require('fs');
  const isDocker = fs.existsSync('/.dockerenv') || 
                   (fs.existsSync('/proc/self/cgroup') && fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker'));
  console.log('2. 运行环境:');
  console.log(`   是否在 Docker 容器内: ${isDocker ? '是' : '否'}\n`);

  // 3. 创建服务实例并显示配置
  const vectorDBService = new VectorDBService();
  console.log('3. VectorDBService 配置:');
  console.log(`   Host: ${vectorDBService.config.host}`);
  console.log(`   Port: ${vectorDBService.config.port}`);
  console.log(`   Database: ${vectorDBService.config.database}`);
  console.log(`   User: ${vectorDBService.config.user}`);
  console.log(`   Password: ${vectorDBService.config.password ? '***已设置***' : '(未设置)'}\n`);

  // 4. 尝试连接
  console.log('4. 尝试连接数据库...');
  try {
    await vectorDBService.initialize();
    console.log('   ✅ 连接成功！\n');

    // 5. 测试查询
    console.log('5. 测试查询...');
    const pool = vectorDBService.getPool();
    const result = await pool.query('SELECT version()');
    console.log(`   ✅ PostgreSQL 版本: ${result.rows[0].version}\n`);

    // 6. 检查 pgvector 扩展
    console.log('6. 检查 pgvector 扩展...');
    const extResult = await pool.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname = 'vector'
    `);
    if (extResult.rows.length > 0) {
      console.log(`   ✅ pgvector 扩展已安装 (版本: ${extResult.rows[0].extversion})\n`);
    } else {
      console.log('   ⚠️  pgvector 扩展未找到\n');
    }

    // 7. 检查表是否存在
    console.log('7. 检查表结构...');
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('file_vectors', 'semantic_model_vectors', 'qa_pair_vectors', 'business_knowledge_vectors')
      ORDER BY table_name
    `);
    const foundTables = tablesResult.rows.map(r => r.table_name);
    console.log(`   ✅ 找到表: ${foundTables.length > 0 ? foundTables.join(', ') : '(无)'}\n`);

    console.log('========== 诊断完成 ==========\n');
    process.exit(0);
  } catch (error) {
    console.log(`   ❌ 连接失败！\n`);
    console.log('错误详情:');
    console.log(`   消息: ${error.message}`);
    console.log(`   代码: ${error.code || 'N/A'}`);
    if (error.stack) {
      console.log(`   堆栈:\n${error.stack}`);
    }
    console.log('\n========== 诊断完成 ==========\n');
    process.exit(1);
  }
}

diagnose().catch((error) => {
  console.error('诊断脚本执行失败:', error);
  process.exit(1);
});
