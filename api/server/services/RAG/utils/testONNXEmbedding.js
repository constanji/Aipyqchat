/**
 * 测试 ONNX 嵌入服务脚本
 * 使用方法: node api/server/services/RAG/utils/testONNXEmbedding.js
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

async function testONNXEmbedding() {
  console.log('开始测试 ONNX 嵌入服务...\n');

  // 1. 检查环境变量
  console.log('1. 检查环境变量...');
  console.log(`   USE_ONNX_EMBEDDING: ${process.env.USE_ONNX_EMBEDDING || 'not set'}`);
  console.log(`   EMBEDDING_MODEL: ${process.env.EMBEDDING_MODEL || 'not set'}`);
  console.log(`   USE_VECTOR_DB: ${process.env.USE_VECTOR_DB || 'not set'}`);
  console.log('');

  // 2. 检查模型文件
  console.log('2. 检查模型文件...');
  const serviceDir = path.resolve(__dirname, '..'); // 指向 RAG 服务目录
  const modelPath = path.join(serviceDir, 'onnx', 'embedding', 'resources');
  const modelFile = path.join(modelPath, 'bge-small-zh-v1.5-q.onnx');
  const tokenizerFile = path.join(modelPath, 'bge-small-zh-v1.5-q-tokenizer.json');

  console.log(`   服务目录: ${serviceDir}`);
  console.log(`   模型目录: ${modelPath}`);
  console.log(`   模型文件: ${modelFile}`);
  console.log(`   Model exists: ${fs.existsSync(modelFile) ? '✅' : '❌'}`);
  console.log(`   Tokenizer exists: ${fs.existsSync(tokenizerFile) ? '✅' : '❌'}`);
  console.log('');

  if (!fs.existsSync(modelFile) || !fs.existsSync(tokenizerFile)) {
    console.error('❌ 模型文件缺失，请确保文件存在于正确的位置');
    return;
  }

  // 3. 检查 @xenova/transformers
  console.log('3. 检查 @xenova/transformers 包...');
  try {
    const transformers = require('@xenova/transformers');
    console.log('   ✅ @xenova/transformers 已安装');
    console.log(`   版本信息: ${transformers.version || 'unknown'}`);
  } catch (error) {
    console.error('   ❌ @xenova/transformers 未安装');
    console.error(`   错误: ${error.message}`);
    console.error('   请运行: npm install @xenova/transformers');
    return;
  }
  console.log('');

  // 4. 测试 ONNXEmbeddingService
  console.log('4. 测试 ONNXEmbeddingService 初始化...');
  try {
    const ONNXEmbeddingService = require('../ONNXEmbeddingService');
    const service = new ONNXEmbeddingService();
    
    console.log('   正在初始化服务...');
    await service.initialize();
    console.log('   ✅ 服务初始化成功');
    console.log('');
  } catch (error) {
    console.error('   ❌ 服务初始化失败');
    console.error(`   错误: ${error.message}`);
    console.error(`   堆栈: ${error.stack}`);
    return;
  }

  // 5. 测试文本嵌入
  console.log('5. 测试文本嵌入...');
  try {
    const ONNXEmbeddingService = require('../ONNXEmbeddingService');
    const service = new ONNXEmbeddingService();
    
    const testText = '这是一个测试文本';
    console.log(`   测试文本: "${testText}"`);
    
    const startTime = Date.now();
    const embedding = await service.embedText(testText);
    const duration = Date.now() - startTime;
    
    if (embedding && Array.isArray(embedding)) {
      console.log(`   ✅ 嵌入成功`);
      console.log(`   向量维度: ${embedding.length}`);
      console.log(`   耗时: ${duration}ms`);
      console.log(`   前5个值: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
    } else {
      console.error('   ❌ 嵌入失败：返回结果无效');
    }
  } catch (error) {
    console.error('   ❌ 嵌入测试失败');
    console.error(`   错误: ${error.message}`);
    console.error(`   堆栈: ${error.stack}`);
    return;
  }
  console.log('');

  // 6. 测试完整流程（通过 EmbeddingService）
  console.log('6. 测试完整嵌入流程（通过 EmbeddingService）...');
  try {
    const EmbeddingService = require('../EmbeddingService');
    const service = new EmbeddingService();
    
    const testText = '测试完整的嵌入服务流程';
    console.log(`   测试文本: "${testText}"`);
    
    const startTime = Date.now();
    const embedding = await service.embedText(testText, 'test_user');
    const duration = Date.now() - startTime;
    
    if (embedding && Array.isArray(embedding)) {
      console.log(`   ✅ 嵌入成功`);
      console.log(`   向量维度: ${embedding.length}`);
      console.log(`   耗时: ${duration}ms`);
      console.log(`   使用的方法: ${service.useONNX ? 'ONNX' : '其他'}`);
    } else {
      console.error('   ❌ 嵌入失败：返回结果为 null');
      console.error('   可能的原因：');
      console.error('   1. ONNX 模型初始化失败');
      console.error('   2. 所有嵌入方法都失败');
      console.error('   3. 配置错误');
    }
  } catch (error) {
    console.error('   ❌ 完整流程测试失败');
    console.error(`   错误: ${error.message}`);
    console.error(`   堆栈: ${error.stack}`);
    return;
  }
  console.log('');

  console.log('✅ 所有测试完成！');
}

if (require.main === module) {
  testONNXEmbedding()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('测试出错:', error);
      process.exit(1);
    });
}

module.exports = testONNXEmbedding;

