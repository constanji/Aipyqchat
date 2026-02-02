/**
 * 迁移向量数据库表维度脚本
 * 将表结构从 384 维迁移到 512 维（或其他维度）
 * 使用方法: node api/server/services/RAG/utils/migrateVectorDimension.js [目标维度]
 * 
 * 示例:
 *   node api/server/services/RAG/utils/migrateVectorDimension.js 512
 */

require('dotenv').config();
const VectorDBService = require('../VectorDBService');

const TARGET_DIMENSION = parseInt(process.argv[2] || process.env.EMBEDDING_DIMENSION || '512', 10);

const tables = [
  'semantic_model_vectors',
  'qa_pair_vectors',
  'synonym_vectors',
  'business_knowledge_vectors',
  'file_vectors',
];

async function migrateDimension() {
  console.log(`开始迁移向量维度到 ${TARGET_DIMENSION}...\n`);

  const vectorDBService = new VectorDBService();
  
  try {
    // 初始化连接
    console.log('1. 连接数据库...');
    await vectorDBService.initialize();
    console.log('✅ 数据库连接成功\n');

    const pool = vectorDBService.getPool();

    // 检查当前维度
    console.log('2. 检查当前表结构...');
    for (const tableName of tables) {
      try {
        const result = await pool.query(`
          SELECT 
            column_name,
            data_type,
            udt_name
          FROM information_schema.columns 
          WHERE table_name = $1 
          AND column_name = 'embedding'
        `, [tableName]);

        if (result.rows.length > 0) {
          const col = result.rows[0];
          // pgvector 的维度信息在类型定义中，需要查询实际的表定义
          const tableDef = await pool.query(`
            SELECT pg_get_tabledef($1)
          `, [tableName]);
          
          console.log(`  ${tableName}: embedding 列存在`);
          
          // 尝试查询一条记录以检查实际维度（如果有数据）
          const sampleResult = await pool.query(`
            SELECT embedding 
            FROM ${tableName} 
            LIMIT 1
          `);
          
          if (sampleResult.rows.length > 0 && sampleResult.rows[0].embedding) {
            // 如果 embedding 是数组格式，获取长度
            const embeddingValue = sampleResult.rows[0].embedding;
            if (Array.isArray(embeddingValue)) {
              console.log(`    当前维度: ${embeddingValue.length}`);
            }
          }
        } else {
          console.log(`  ${tableName}: embedding 列不存在（可能是新表）`);
        }
      } catch (error) {
        console.log(`  ${tableName}: 表不存在或查询失败 - ${error.message}`);
      }
    }
    console.log('');

    // 迁移每个表
    console.log(`3. 迁移表维度到 ${TARGET_DIMENSION}...\n`);
    
    for (const tableName of tables) {
      try {
        // 检查表是否存在
        const tableExists = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )
        `, [tableName]);

        if (!tableExists.rows[0].exists) {
          console.log(`  ⏭️  ${tableName}: 表不存在，跳过（将在下次初始化时创建）`);
          continue;
        }

        // 删除旧的 HNSW 索引（如果存在）
        console.log(`  ${tableName}: 删除旧索引...`);
        try {
          await pool.query(`
            DROP INDEX IF EXISTS idx_${tableName}_embedding_hnsw
          `);
          console.log(`    ✅ 索引已删除`);
        } catch (error) {
          console.log(`    ⚠️  删除索引失败（可能不存在）: ${error.message}`);
        }

        // 修改 embedding 列类型
        console.log(`  ${tableName}: 修改 embedding 列类型...`);
        try {
          await pool.query(`
            ALTER TABLE ${tableName}
            ALTER COLUMN embedding TYPE vector(${TARGET_DIMENSION})
          `);
          console.log(`    ✅ embedding 列类型已更新为 vector(${TARGET_DIMENSION})`);
        } catch (error) {
          if (error.message.includes('does not exist')) {
            console.log(`    ⚠️  列不存在，将在下次初始化时创建`);
          } else {
            console.log(`    ❌ 更新失败: ${error.message}`);
            throw error;
          }
        }

        // 重新创建 HNSW 索引
        console.log(`  ${tableName}: 创建新索引...`);
        try {
          await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding_hnsw 
            ON ${tableName} 
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
          `);
          console.log(`    ✅ HNSW 索引已创建\n`);
        } catch (error) {
          console.log(`    ❌ 创建索引失败: ${error.message}\n`);
          throw error;
        }

      } catch (error) {
        console.error(`  ❌ ${tableName} 迁移失败: ${error.message}\n`);
        // 继续处理其他表
      }
    }

    console.log('✅ 迁移完成！\n');

    // 验证迁移结果
    console.log('4. 验证迁移结果...');
    for (const tableName of tables) {
      try {
        const result = await pool.query(`
          SELECT embedding 
          FROM ${tableName} 
          WHERE embedding IS NOT NULL
          LIMIT 1
        `);
        
        if (result.rows.length > 0 && result.rows[0].embedding) {
          const embeddingValue = result.rows[0].embedding;
          if (Array.isArray(embeddingValue)) {
            const actualDim = embeddingValue.length;
            if (actualDim === TARGET_DIMENSION) {
              console.log(`  ✅ ${tableName}: 维度正确 (${actualDim})`);
            } else {
              console.log(`  ⚠️  ${tableName}: 维度不匹配 (当前: ${actualDim}, 期望: ${TARGET_DIMENSION})`);
            }
          }
        } else {
          console.log(`  ⏭️  ${tableName}: 暂无数据`);
        }
      } catch (error) {
        console.log(`  ❌ ${tableName}: 验证失败 - ${error.message}`);
      }
    }

    console.log('\n✅ 所有迁移和验证完成！');
    console.log(`\n提示: 现在可以在 .env 中设置 EMBEDDING_DIMENSION=${TARGET_DIMENSION} 以确保一致性`);

  } catch (error) {
    console.error('\n❌ 迁移失败:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (vectorDBService.pool) {
      await vectorDBService.pool.end();
      console.log('\n数据库连接已关闭');
    }
  }
}

if (require.main === module) {
  migrateDimension()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('错误:', error);
      process.exit(1);
    });
}

module.exports = migrateDimension;

