/**
 * 下载 ONNX Reranker 模型所需的所有文件
 * 使用方法: node api/server/services/RAG/utils/downloadONNXRerankerFiles.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const resourcesDir = path.join(__dirname, '../onnx/reranker/resources');
const baseUrl = 'https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2/raw/main';

// 需要下载的文件列表
const filesToDownload = [
  {
    url: `${baseUrl}/tokenizer.json`,
    filename: 'ms-marco-MiniLM-L6-v2-tokenizer.json',
    required: false, // 已有，但如果需要可以重新下载
  },
  {
    url: `${baseUrl}/tokenizer_config.json`,
    filename: 'tokenizer_config.json',
    required: true,
  },
  {
    url: `${baseUrl}/special_tokens_map.json`,
    filename: 'special_tokens_map.json',
    required: false,
  },
  {
    url: `${baseUrl}/config.json`,
    filename: 'config.json',
    required: true,
  },
];

// 处理重定向（支持禁用 SSL 验证）
function followRedirect(url, maxRedirects = 5, rejectUnauthorized = false) {
  return new Promise((resolve, reject) => {
    if (maxRedirects === 0) {
      return reject(new Error('Too many redirects'));
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      rejectUnauthorized: !rejectUnauthorized, // 如果 rejectUnauthorized=true，则禁用 SSL 验证
    };

    const req = client.request(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const redirectUrl = res.headers.location;
        if (!redirectUrl) {
          return reject(new Error('Redirect without location header'));
        }
        // 处理相对重定向
        const newUrl = redirectUrl.startsWith('http') ? redirectUrl : `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
        return followRedirect(newUrl, maxRedirects - 1, rejectUnauthorized).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }

      resolve(res);
    });

    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, destPath, useInsecureSSL = false) {
  return new Promise((resolve, reject) => {
    console.log(`  下载: ${path.basename(destPath)}...`);
    
    followRedirect(url, 5, useInsecureSSL)
      .then((response) => {
        const file = fs.createWriteStream(destPath);
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          const stats = fs.statSync(destPath);
          console.log(`  ✅ ${path.basename(destPath)} (${(stats.size / 1024).toFixed(2)} KB)`);
          resolve();
        });
        
        file.on('error', (err) => {
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
          reject(err);
        });
      })
      .catch((err) => {
        reject(err);
      });
  });
}

async function downloadAllFiles() {
  console.log('开始下载 ONNX Reranker 模型文件...\n');
  console.log(`目标目录: ${resourcesDir}\n`);

  // 确保目录存在
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  // 检查现有文件
  console.log('检查现有文件...');
  const existingFiles = fs.readdirSync(resourcesDir);
  existingFiles.forEach(file => {
    if (file.endsWith('.json') || file.endsWith('.onnx')) {
      const stats = fs.statSync(path.join(resourcesDir, file));
      console.log(`  ✅ ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
    }
  });
  console.log('');

  // 下载缺失的文件
  console.log('下载缺失的文件...\n');
  const useInsecureSSL = process.env.ALLOW_INSECURE_SSL === 'true' || process.env.NODE_ENV === 'development';
  if (useInsecureSSL) {
    console.log('  ℹ️  使用不安全 SSL 模式（ALLOW_INSECURE_SSL=true 或 NODE_ENV=development）\n');
  }
  
  let successCount = 0;
  let failCount = 0;

  for (const fileInfo of filesToDownload) {
    const destPath = path.join(resourcesDir, fileInfo.filename);
    
    // 如果文件已存在，询问是否跳过
    if (fs.existsSync(destPath)) {
      if (!fileInfo.required) {
        console.log(`  ⏭️  ${fileInfo.filename} 已存在，跳过`);
        continue;
      } else {
        console.log(`  ⚠️  ${fileInfo.filename} 已存在，但标记为必须，重新下载...`);
      }
    }

    try {
      await downloadFile(fileInfo.url, destPath, useInsecureSSL);
      successCount++;
    } catch (error) {
      console.log(`  ❌ ${fileInfo.filename} 下载失败: ${error.message}`);
      
      // 如果是 SSL 错误，尝试使用 curl 命令
      if (error.message.includes('certificate') || error.message.includes('SSL')) {
        console.log(`     🔄 尝试使用 curl 命令下载...`);
        try {
          const { execSync } = require('child_process');
          execSync(`curl -L -k -o "${destPath}" "${fileInfo.url}"`, { stdio: 'ignore' });
          if (fs.existsSync(destPath)) {
            const stats = fs.statSync(destPath);
            console.log(`  ✅ ${fileInfo.filename} (使用 curl 下载成功, ${(stats.size / 1024).toFixed(2)} KB)`);
            successCount++;
            failCount--; // 抵消之前的失败计数
            continue;
          }
        } catch (curlError) {
          console.log(`     ❌ curl 下载也失败: ${curlError.message}`);
        }
      }
      
      failCount++;
      
      if (fileInfo.required) {
        console.log(`     ⚠️  此文件是必需的，请手动下载:`);
        console.log(`        URL: ${fileInfo.url}`);
        console.log(`        保存到: ${destPath}`);
        console.log(`        或运行: curl -L -o "${destPath}" "${fileInfo.url}"`);
      }
    }
  }

  console.log('\n下载完成！');
  console.log(`成功: ${successCount}, 失败: ${failCount}\n`);

  // 验证所有必需文件
  console.log('验证文件完整性...');
  const requiredFiles = [
    'config.json',
    'ms-marco-MiniLM-L6-v2-tokenizer.json',
    'tokenizer_config.json',
  ];

  const recommendedFiles = [
    'special_tokens_map.json',
  ];

  let allRequired = true;
  for (const filename of requiredFiles) {
    const filePath = path.join(resourcesDir, filename);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`  ✅ ${filename} (${(stats.size / 1024).toFixed(2)} KB)`);
    } else {
      console.log(`  ❌ ${filename} 缺失（必需）`);
      allRequired = false;
    }
  }

  for (const filename of recommendedFiles) {
    const filePath = path.join(resourcesDir, filename);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`  ✅ ${filename} (${(stats.size / 1024).toFixed(2)} KB)`);
    } else {
      console.log(`  ⚠️  ${filename} 缺失（推荐）`);
    }
  }

  // 检查 ONNX 模型文件
  const onnxFiles = fs.readdirSync(resourcesDir).filter(f => f.endsWith('.onnx'));
  if (onnxFiles.length > 0) {
    console.log('\nONNX 模型文件:');
    onnxFiles.forEach(file => {
      const stats = fs.statSync(path.join(resourcesDir, file));
      console.log(`  ✅ ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    });
  } else {
    console.log('\n  ⚠️  未找到 ONNX 模型文件（*.onnx）');
  }

  if (allRequired) {
    console.log('\n✅ 所有必需文件已就绪！');
    console.log('现在可以运行测试验证 Reranker 服务');
  } else {
    console.log('\n❌ 部分必需文件缺失，请检查上面的错误信息');
  }
}

if (require.main === module) {
  downloadAllFiles()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n下载过程出错:', error);
      process.exit(1);
    });
}

module.exports = downloadAllFiles;

