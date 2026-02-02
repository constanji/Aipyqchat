/**
 * 测试 ONNX Reranker 服务脚本
 * 使用方法: node api/server/services/RAG/utils/testONNXReranker.js
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

async function testONNXReranker() {
  console.log('开始测试 ONNX Reranker 服务...\n');

  // 1. 检查环境变量
  console.log('1. 检查环境变量...');
  console.log(`   USE_ONNX_RERANKER: ${process.env.USE_ONNX_RERANKER || 'not set (default: true)'}`);
  console.log(`   RERANKER_TYPE: ${process.env.RERANKER_TYPE || 'not set (default: onnx)'}`);
  console.log(`   USE_VECTOR_DB: ${process.env.USE_VECTOR_DB || 'not set'}`);
  console.log('');

  // 2. 检查模型文件
  console.log('2. 检查模型文件...');
  const serviceDir = path.resolve(__dirname, '..'); // 指向 RAG 服务目录
  const modelPath = path.join(serviceDir, 'onnx', 'reranker', 'resources');
  const modelFile = path.join(modelPath, 'ms-marco-MiniLM-L6-v2.onnx');
  const tokenizerFile = path.join(modelPath, 'ms-marco-MiniLM-L6-v2-tokenizer.json');
  const configFile = path.join(modelPath, 'config.json');
  const tokenizerConfigFile = path.join(modelPath, 'tokenizer_config.json');

  console.log(`   服务目录: ${serviceDir}`);
  console.log(`   模型目录: ${modelPath}`);
  console.log(`   Model exists: ${fs.existsSync(modelFile) ? '✅' : '❌'}`);
  console.log(`   Tokenizer exists: ${fs.existsSync(tokenizerFile) ? '✅' : '❌'}`);
  console.log(`   Config exists: ${fs.existsSync(configFile) ? '✅' : '❌'}`);
  console.log(`   Tokenizer config exists: ${fs.existsSync(tokenizerConfigFile) ? '✅' : '❌'}`);
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

  // 4. 测试 ONNXRerankingService
  console.log('4. 测试 ONNXRerankingService 初始化...');
  try {
    const ONNXRerankingService = require('../ONNXRerankingService');
    const service = new ONNXRerankingService();
    
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

  // 5. 测试文档重排序
  console.log('5. 测试文档重排序...');
  try {
    const ONNXRerankingService = require('../ONNXRerankingService');
    const service = new ONNXRerankingService();
    
    const query = '人工智能是什么？';
    const documents = [
      '人工智能是计算机科学的一个分支，旨在创建能够执行通常需要人类智能的任务的系统。',
      '今天天气很好，适合出去散步。',
      '机器学习是人工智能的一个子领域，通过算法让计算机从数据中学习。',
      '我喜欢吃苹果和香蕉。',
      '深度学习使用神经网络来模拟人脑的学习过程。',
    ];
    
    console.log(`   查询: "${query}"`);
    console.log(`   文档数量: ${documents.length}`);
    
    const startTime = Date.now();
    const results = await service.rerank(query, documents, 3);
    const duration = Date.now() - startTime;
    
    if (results && Array.isArray(results) && results.length > 0) {
      console.log(`   ✅ 重排序成功`);
      console.log(`   返回结果数: ${results.length}`);
      console.log(`   耗时: ${duration}ms`);
      console.log(`   重排序结果:`);
      results.forEach((result, index) => {
        console.log(`     ${index + 1}. Score: ${result.score.toFixed(4)}`);
        console.log(`        ${result.text.substring(0, 50)}...`);
      });
    } else {
      console.error('   ❌ 重排序失败：返回结果无效');
    }
  } catch (error) {
    console.error('   ❌ 重排序测试失败');
    console.error(`   错误: ${error.message}`);
    console.error(`   堆栈: ${error.stack}`);
    return;
  }
  console.log('');

  // 6. 测试完整流程（通过 RerankingService）
  console.log('6. 测试完整重排序流程（通过 RerankingService）...');
  try {
    const RerankingService = require('../RerankingService');
    const service = new RerankingService();
    
    const query = '自然语言处理的应用';
    const documents = [
      '自然语言处理可以用于机器翻译。',
      '今天的股票市场上涨了。',
      '聊天机器人使用自然语言处理技术。',
      '我喜欢看电影。',
      '文本摘要也是自然语言处理的应用之一。',
    ];
    
    console.log(`   查询: "${query}"`);
    console.log(`   文档数量: ${documents.length}`);
    
    const startTime = Date.now();
    const results = await service.rerank(query, documents, 3);
    const duration = Date.now() - startTime;
    
    if (results && Array.isArray(results) && results.length > 0) {
      console.log(`   ✅ 重排序成功`);
      console.log(`   返回结果数: ${results.length}`);
      console.log(`   耗时: ${duration}ms`);
      console.log(`   使用的重排器: ${service.reranker?.type || 'default'}`);
    } else {
      console.error('   ❌ 重排序失败：返回结果为空');
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
  testONNXReranker()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('测试出错:', error);
      process.exit(1);
    });
}

module.exports = testONNXReranker;

