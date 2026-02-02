/**
 * 清理重复的知识库条目脚本
 * 使用方法: node api/server/services/RAG/utils/cleanupDuplicateKnowledge.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { createModels } = require('@aipyq/data-schemas');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('请设置 MONGO_URI 环境变量');
  process.exit(1);
}

async function cleanupDuplicates() {
  try {
    console.log('连接 MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB 连接成功');

    const models = createModels(mongoose);
    const KnowledgeEntry = models.KnowledgeEntry;

    // 查找所有语义模型条目
    const allEntries = await KnowledgeEntry.find({ type: 'semantic_model' })
      .sort({ createdAt: -1 })
      .lean();

    console.log(`\n找到 ${allEntries.length} 条语义模型条目`);

    // 先分离父级和子级
    const parentEntries = allEntries.filter(e => !e.parent_id);
    const childEntries = allEntries.filter(e => e.parent_id);
    
    console.log(`  父级条目: ${parentEntries.length} 条`);
    console.log(`  子级条目: ${childEntries.length} 条`);

    // 按 database_name 和 is_database_level 分组父级条目
    const parentGroups = {};
    parentEntries.forEach(entry => {
      const dbName = entry.metadata?.database_name || 'unknown';
      const isDatabaseLevel = entry.metadata?.is_database_level || false;
      const key = `${dbName}:${isDatabaseLevel}`;
      
      if (!parentGroups[key]) {
        parentGroups[key] = [];
      }
      parentGroups[key].push(entry);
    });

    // 找出重复的父级（同一个 database_name 有多条记录）
    const duplicates = Object.entries(parentGroups).filter(([key, entries]) => entries.length > 1);

    console.log(`\n找到 ${duplicates.length} 组重复的父级条目：`);
    
    let totalToDelete = 0;
    for (const [key, entries] of duplicates) {
      // 保留最新的条目（createdAt 最新的）
      const sorted = entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const toKeep = sorted[0];
      const toDelete = sorted.slice(1);
      
      console.log(`\n${key}:`);
      console.log(`  保留: ${toKeep._id} (${toKeep.title}, createdAt: ${toKeep.createdAt})`);
      console.log(`  删除: ${toDelete.length} 条父级`);
      toDelete.forEach(entry => {
        console.log(`    - ${entry._id} (${entry.title}, createdAt: ${entry.createdAt})`);
      });
      
      // 删除重复的父级条目及其所有子项
      for (const parentEntry of toDelete) {
        // 先删除所有子项
        const childrenResult = await KnowledgeEntry.deleteMany({ parent_id: parentEntry._id });
        console.log(`    删除 ${parentEntry._id} 的 ${childrenResult.deletedCount} 个子项`);
        
        // 再删除父级
        const result = await KnowledgeEntry.deleteOne({ _id: parentEntry._id });
        console.log(`    ✅ 已删除父级 ${parentEntry._id}`);
        totalToDelete += 1 + childrenResult.deletedCount;
      }
    }

    // 清理孤儿子项（parent_id 指向不存在的父级的子项）
    console.log(`\n检查孤儿子项...`);
    const allParentIds = new Set(parentEntries.map(e => e._id.toString()));
    const orphanChildren = childEntries.filter(child => {
      const parentId = child.parent_id?.toString();
      return parentId && !allParentIds.has(parentId);
    });

    if (orphanChildren.length > 0) {
      console.log(`找到 ${orphanChildren.length} 个孤儿子项（parent_id 指向不存在的父级）`);
      orphanChildren.forEach((child, index) => {
        console.log(`  ${index + 1}. ${child.title} (${child._id})`);
        console.log(`     parent_id: ${child.parent_id} (父级不存在)`);
      });

      const orphanIds = orphanChildren.map(e => e._id);
      const orphanDeleteResult = await KnowledgeEntry.deleteMany({ _id: { $in: orphanIds } });
      console.log(`\n✅ 已删除 ${orphanDeleteResult.deletedCount} 个孤儿子项`);
      totalToDelete += orphanDeleteResult.deletedCount;
    } else {
      console.log(`没有找到孤儿子项`);
    }

    // 统计最终结果
    const finalCount = await KnowledgeEntry.countDocuments({ type: 'semantic_model' });
    console.log(`\n清理完成！`);
    console.log(`删除重复条目: ${totalToDelete} 条`);
    console.log(`剩余语义模型条目: ${finalCount} 条`);

    // 显示剩余的条目
    const remaining = await KnowledgeEntry.find({ type: 'semantic_model' })
      .sort({ createdAt: -1 })
      .lean();
    
    const remainingParents = remaining.filter(e => !e.parent_id);
    const remainingChildren = remaining.filter(e => e.parent_id);
    
    console.log(`\n剩余的语义模型条目：`);
    console.log(`  父级: ${remainingParents.length} 条`);
    remainingParents.forEach((entry, index) => {
      const dbName = entry.metadata?.database_name || 'unknown';
      const isDatabaseLevel = entry.metadata?.is_database_level || false;
      console.log(`    ${index + 1}. ${entry.title} (${entry._id})`);
      console.log(`       database: ${dbName}, is_database_level: ${isDatabaseLevel}`);
    });
    
    console.log(`  子级: ${remainingChildren.length} 条`);
    remainingChildren.forEach((entry, index) => {
      const parentId = entry.parent_id || 'null';
      const dbName = entry.metadata?.database_name || 'unknown';
      const modelId = entry.metadata?.semantic_model_id || 'unknown';
      console.log(`    ${index + 1}. ${entry.title} (${entry._id})`);
      console.log(`       parent_id: ${parentId}, database: ${dbName}, model_id: ${modelId}`);
    });

    await mongoose.disconnect();
    console.log('\n✅ 完成');
  } catch (error) {
    console.error('❌ 清理失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  cleanupDuplicates()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('错误:', error);
      process.exit(1);
    });
}

module.exports = cleanupDuplicates;
