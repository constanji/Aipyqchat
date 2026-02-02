/**
 * 设置 ONNX 模型缓存脚本
 * 将本地模型文件复制到 @xenova/transformers 缓存目录
 * 使用方法: node api/server/services/RAG/utils/setupONNXCache.js
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { promisify } = require('util');

const cacheDir = path.join(
  __dirname,
  '../../../../node_modules/@xenova/transformers/.cache/hub/models--Xenova--bge-small-zh-v1.5/snapshots/main'
);
const onnxCacheDir = path.join(cacheDir, 'onnx');
const modelResourcesDir = path.join(__dirname, '../onnx/embedding/resources');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 200 || response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        const redirectUrl = response.headers.location || url;
        if (response.statusCode !== 200) {
          return downloadFile(redirectUrl, dest).then(resolve).catch(reject);
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Failed to download: ${response.statusCode}`));
      }
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
      reject(err);
    });
  });
}

async function setupONNXCache() {
  console.log('开始设置 ONNX 模型缓存...\n');

  // 1. 创建缓存目录
  console.log('1. 创建缓存目录...');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(onnxCacheDir, { recursive: true });
  console.log(`   ✅ 缓存目录: ${cacheDir}\n`);

  // 2. 复制本地文件
  console.log('2. 复制本地模型文件...');
  const filesToCopy = [
    {
      source: path.join(modelResourcesDir, 'config.json'),
      dest: path.join(cacheDir, 'config.json'),
      name: 'config.json',
    },
    {
      source: path.join(modelResourcesDir, 'bge-small-zh-v1.5-q-tokenizer.json'),
      dest: path.join(cacheDir, 'tokenizer.json'),
      name: 'tokenizer.json',
    },
    {
      source: path.join(modelResourcesDir, 'bge-small-zh-v1.5-q.onnx'),
      dest: path.join(onnxCacheDir, 'model_quantized.onnx'),
      name: 'ONNX model',
    },
  ];

  for (const file of filesToCopy) {
    if (fs.existsSync(file.source)) {
      fs.copyFileSync(file.source, file.dest);
      console.log(`   ✅ ${file.name}`);
    } else {
      console.log(`   ⚠️  ${file.name} 不存在: ${file.source}`);
    }
  }
  console.log('');

  // 3. 下载缺失的文件
  console.log('3. 下载缺失的文件...');
  const filesToDownload = [
    {
      url: 'https://huggingface.co/Xenova/bge-small-zh-v1.5/raw/main/tokenizer_config.json',
      dest: path.join(cacheDir, 'tokenizer_config.json'),
      name: 'tokenizer_config.json',
    },
  ];

  for (const file of filesToDownload) {
    if (fs.existsSync(file.dest)) {
      console.log(`   ⏭️  ${file.name} 已存在，跳过`);
      continue;
    }

    try {
      console.log(`   ⬇️  下载 ${file.name}...`);
      await downloadFile(file.url, file.dest);
      console.log(`   ✅ ${file.name} 下载成功`);
    } catch (error) {
      console.error(`   ❌ ${file.name} 下载失败: ${error.message}`);
      console.error(`   提示: 如果网络有问题，可以手动下载到: ${file.dest}`);
    }
  }
  console.log('');

  // 4. 验证文件
  console.log('4. 验证缓存文件...');
  const requiredFiles = [
    path.join(cacheDir, 'config.json'),
    path.join(cacheDir, 'tokenizer.json'),
    path.join(cacheDir, 'tokenizer_config.json'),
    path.join(onnxCacheDir, 'model_quantized.onnx'),
  ];

  let allFilesExist = true;
  for (const filePath of requiredFiles) {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`   ✅ ${path.basename(filePath)} (${(stats.size / 1024).toFixed(2)} KB)`);
    } else {
      console.log(`   ❌ ${path.basename(filePath)} 缺失`);
      allFilesExist = false;
    }
  }

  if (allFilesExist) {
    console.log('\n✅ ONNX 模型缓存设置完成！');
    console.log('现在可以运行测试脚本验证: node api/server/services/RAG/utils/testONNXEmbedding.js');
  } else {
    console.log('\n⚠️  部分文件缺失，可能需要手动下载或检查网络连接');
  }
}

if (require.main === module) {
  setupONNXCache()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('设置失败:', error);
      process.exit(1);
    });
}

module.exports = setupONNXCache;

