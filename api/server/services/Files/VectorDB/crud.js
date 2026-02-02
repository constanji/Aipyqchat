const fs = require('fs');
const path = require('path');
const { createReadStream } = require('fs');
const { pipeline } = require('stream/promises');
const { logger } = require('@aipyq/data-schemas');
const { FileSources } = require('@aipyq/data-provider');
const VectorDBService = require('~/server/services/RAG/VectorDBService');
const EmbeddingService = require('~/server/services/RAG/EmbeddingService');
const PDFParseService = require('~/server/services/RAG/PDFParseService');
const WordParseService = require('~/server/services/RAG/WordParseService');
const { readFileAsString } = require('@aipyq/api');
const { fixFilenameEncoding } = require('~/server/utils/files');

// 初始化服务实例
const vectorDBService = new VectorDBService();
const embeddingService = new EmbeddingService();
const pdfParseService = new PDFParseService();
const wordParseService = new WordParseService();

/**
 * 流式文本分块函数 - 参考 PDF/Word 的处理方式
 * 边读边分块，避免一次性加载整个文件到内存
 * 优化：减少字符串操作，及时清理中间变量
 * @param {string} filePath - 文件路径
 * @param {number} chunkSize - 块大小（默认1000）
 * @param {number} chunkOverlap - 重叠大小（默认150）
 * @param {number} fileSize - 文件大小（字节）
 * @returns {Promise<Array<string>>} 文本块数组
 */
async function chunkTextStreaming(filePath, chunkSize = 1000, chunkOverlap = 150, fileSize = 0) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let buffer = '';
    let chunkCount = 0;
    
    // 分隔符优先级：从大到小（参考 PDF/Word 的处理方式）
    const separators = [
      '\n\n',      // 段落分隔
      '\n',        // 行分隔
      '。',        // 中文句号
      '. ',        // 英文句号+空格
      '！',        // 中文感叹号
      '! ',        // 英文感叹号+空格
      '？',        // 中文问号
      '? ',        // 英文问号+空格
      '；',        // 中文分号
      '; ',        // 英文分号+空格
      '，',        // 中文逗号
      ', ',        // 英文逗号+空格
      ' ',         // 空格
      '',          // 字符边界（最后手段）
    ];
    
    const stream = createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 32 * 1024, // 32KB chunks（减小以降低内存峰值）
    });
    
    stream.on('data', (data) => {
      buffer += data;
      
      // 当缓冲区足够大时，处理分块
      while (buffer.length >= chunkSize) {
        let endIndex = chunkSize;
        let chunk = null;
        
        // 尝试在分隔符处分割
        if (buffer.length > chunkSize) {
          const searchBuffer = buffer.substring(0, Math.min(chunkSize * 1.5, buffer.length));
          for (const separator of separators) {
            const lastIndex = searchBuffer.lastIndexOf(separator);
            if (lastIndex > chunkSize * 0.5) {
              endIndex = lastIndex + separator.length;
              chunk = buffer.substring(0, endIndex).trim();
              break;
            }
          }
        }
        
        // 如果没有找到合适的分隔符，直接截取
        if (chunk === null) {
          chunk = buffer.substring(0, endIndex).trim();
        }
        
        // 只保存非空的 chunk
        if (chunk.length > 0) {
          chunks.push(chunk);
          chunkCount++;
          
          // 每处理一定数量的 chunks 就触发 GC
          if (global.gc && chunkCount % 50 === 0) {
            global.gc();
          }
        }
        
        // 保留重叠部分（优化：直接使用 substring，避免创建中间变量）
        const overlapStart = Math.max(0, endIndex - chunkOverlap);
        buffer = buffer.substring(overlapStart);
        
        // 清理局部变量
        chunk = null;
      }
    });
    
    stream.on('end', () => {
      // 处理剩余的 buffer
      const remaining = buffer.trim();
      if (remaining.length > 0) {
        chunks.push(remaining);
      }
      
      // 清理
      buffer = '';
      
      // 最终 GC
      if (global.gc) {
        global.gc();
      }
      
      resolve(chunks);
    });
    
    stream.on('error', (error) => {
      buffer = '';
      reject(error);
    });
  });
}

/**
 * 简单的文本分块函数（用于小文件）
 * @param {string} text - 要分块的文本
 * @param {number} chunkSize - 块大小（默认1000）
 * @param {number} chunkOverlap - 重叠大小（默认150）
 * @returns {Array<string>} 文本块数组
 */
function chunkText(text, chunkSize = 1000, chunkOverlap = 150) {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks = [];
  let startIndex = 0;
  const textLength = text.length; // 缓存长度，避免重复访问

  // 分隔符优先级：从大到小
  const separators = [
    '\n\n',      // 段落分隔
    '\n',        // 行分隔
    '。',        // 中文句号
    '. ',        // 英文句号+空格
    '！',        // 中文感叹号
    '! ',        // 英文感叹号+空格
    '？',        // 中文问号
    '? ',        // 英文问号+空格
    '；',        // 中文分号
    '; ',        // 英文分号+空格
    '，',        // 中文逗号
    ', ',        // 英文逗号+空格
    ' ',         // 空格
    '',          // 字符边界（最后手段）
  ];

  while (startIndex < textLength) {
    let endIndex = Math.min(startIndex + chunkSize, textLength);
    // 使用 substring 创建 chunk（这是必要的，但会在循环中创建多个副本）
    let chunk = text.substring(startIndex, endIndex);
    let finalChunk = null;

    // 尝试在分隔符处分割
    if (endIndex < textLength) {
      for (const separator of separators) {
        const lastIndex = chunk.lastIndexOf(separator);
        if (lastIndex > chunkSize * 0.5) {
          // 直接创建最终 chunk，避免中间变量
          finalChunk = chunk.substring(0, lastIndex + separator.length).trim();
          endIndex = startIndex + lastIndex + separator.length;
          break;
        }
      }
    }

    // 如果没有找到合适的分隔符，使用原始 chunk
    if (finalChunk === null) {
      finalChunk = chunk.trim();
    }

    // 只保存非空的 chunk
    if (finalChunk.length > 0) {
      chunks.push(finalChunk);
    }

    // 清理局部变量引用
    chunk = null;
    finalChunk = null;

    startIndex = endIndex - chunkOverlap;
    if (startIndex >= textLength) break;
  }

  return chunks;
}

/**
 * Deletes a file from the vector database
 * 使用本地向量数据库服务删除文件向量
 *
 * @param {ServerRequest} req - The request object from Express.
 * @param {MongoFile} file - The file object to be deleted.
 *
 * @returns {Promise<void>}
 */
const deleteVectors = async (req, file) => {
  if (!file.embedded) {
    return;
  }

  try {
    // 使用本地向量数据库服务删除
    await vectorDBService.deleteFileVectors(file.file_id);
    logger.info(`[deleteVectors] 成功删除文件向量: fileId=${file.file_id}`);
  } catch (error) {
    logger.warn('[deleteVectors] 删除文件向量失败:', error.message);
    // 不抛出错误，允许文件删除继续
  }
};

/**
 * Uploads a file to the configured Vector database
 * 使用本地 RAG 服务：文件解析 → 文本分块 → 向量化 → 存储到向量数据库
 *
 * @param {Object} params - The params object.
 * @param {Object} params.req - The request object from Express. It should have a `user` property with an `id` representing the user
 * @param {Express.Multer.File} params.file - The file object, which is part of the request. The file object should
 *                                     have a `path` property that points to the location of the uploaded file.
 * @param {string} params.file_id - The file ID.
 * @param {string} [params.entity_id] - The entity ID for shared resources.
 * @param {Object} [params.storageMetadata] - Storage metadata for dual storage pattern.
 *
 * @returns {Promise<{ filepath: string, bytes: number, embedded: boolean }>}
 *          A promise that resolves to an object containing:
 *            - filepath: The path where the file is saved.
 *            - bytes: The size of the file in bytes.
 *            - embedded: Whether the file was successfully embedded.
 */
async function uploadVectors({ req, file, file_id, entity_id, storageMetadata }) {
  try {
    // 确保向量数据库已初始化（带错误处理）
    if (!vectorDBService.initialized) {
      logger.info('[uploadVectors] 初始化向量数据库连接...');
      try {
        await vectorDBService.initialize();
      } catch (initError) {
        logger.error('[uploadVectors] 向量数据库初始化失败:', initError);
        // 如果初始化失败，返回未向量化的结果，但不阻止文件上传
        return {
          bytes: file.size,
          filename: file.originalname,
          filepath: FileSources.vectordb,
          embedded: false,
        };
      }
    }

    const userId = req.user.id;
    const filePath = file.path;
    const mimeType = file.mimetype;
    // 修复文件名编码问题（multer 可能将 UTF-8 文件名错误地按 Latin1 解码）
    const filename = fixFilenameEncoding(file.originalname);
    const fileExt = path.extname(filename).toLowerCase();

    logger.info(`[uploadVectors] 开始处理文件向量化: fileId=${file_id}, filename=${filename}, mimeType=${mimeType}`);

    let text = '';
    let chunks = [];

    // 1. 根据文件类型解析文件
    if (mimeType === 'application/pdf' || fileExt === '.pdf') {
      logger.info('[uploadVectors] 解析PDF文件');
      await pdfParseService.initialize();
      // parsePDF 已经返回分块后的结果
      chunks = await pdfParseService.parsePDF(filePath, {
        chunkSize: 1000,
        chunkOverlap: 150,
        fileMetadata: {
          file_id,
          filename,
          source: filePath,
        },
      });
    } else if (
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileExt === '.doc' ||
      fileExt === '.docx'
    ) {
      logger.info('[uploadVectors] 解析Word文件');
      await wordParseService.initialize();
      chunks = await wordParseService.parseWordDocument(filePath, {
        chunkSize: 1000,
        chunkOverlap: 150,
        fileMetadata: {
          file_id,
          filename,
          source: filePath,
        },
      });
    } else if (
      mimeType === 'text/plain' ||
      mimeType === 'text/markdown' ||
      fileExt === '.txt' ||
      fileExt === '.md'
    ) {
      logger.info('[uploadVectors] 解析文本文件');
      
      // 参考 PDF/Word 的处理方式：使用流式处理，边读边分块，避免一次性加载整个文件
      // 对于所有文本文件都使用流式处理，因为即使是小文件，如果chunks多也会导致内存问题
      logger.info(`[uploadVectors] 使用流式分块处理文本文件 (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      
      // 使用流式分块，边读边处理
      const textChunks = await chunkTextStreaming(filePath, 1000, 150, file.size);
      
      logger.info(`[uploadVectors] 流式分块完成，共生成 ${textChunks.length} 个文本块`);
      
      // 创建 chunks 数组（参考 PDF/Word 的格式）
      chunks = textChunks.map((chunkText, index) => ({
        text: chunkText,
        metadata: {
          file_id,
          filename,
          source: filePath,
          chunk_index: index,
        },
      }));
      
      // 清理中间变量
      textChunks.length = 0;
      
      // 立即触发 GC
      if (global.gc) {
        global.gc();
        logger.info('[uploadVectors] 已触发 GC 释放内存');
      }
    } else {
      throw new Error(`不支持的文件类型: ${mimeType}`);
    }

    if (chunks.length === 0) {
      logger.warn('[uploadVectors] 文件解析后没有文本内容');
      return {
        bytes: file.size,
        filename: filename,
        filepath: FileSources.vectordb,
        embedded: false,
      };
    }

    logger.info(`[uploadVectors] 文件解析完成，共 ${chunks.length} 个文本块`);

    // 2. 分批处理：向量化和存储（避免内存溢出）
    // 对于大文件，分批处理可以显著减少内存占用
    // 动态调整批次大小：根据文件大小和 chunks 数量动态调整
    // 注意：即使文件很小，如果chunks很多，也要使用小批次，因为每个chunk的向量化都会占用内存
    let BATCH_SIZE;
    if (file.size > 50 * 1024 * 1024) {
      // 超大文件（>50MB）：使用很小批次
      BATCH_SIZE = 10;
    } else if (file.size > 20 * 1024 * 1024) {
      // 大文件（20-50MB）：使用小批次
      BATCH_SIZE = 15;
    } else if (file.size > 10 * 1024 * 1024) {
      // 中等文件（10-20MB）：使用中等批次
      BATCH_SIZE = 20;
    } else if (chunks.length > 500) {
      // chunks 非常多（>500）：使用很小批次，避免内存峰值
      BATCH_SIZE = 10;
    } else if (chunks.length > 300) {
      // chunks 很多（>300）：使用小批次
      BATCH_SIZE = 15;
    } else if (chunks.length > 200) {
      // chunks 较多（>200）：使用较小批次
      BATCH_SIZE = 20;
    } else if (chunks.length > 100) {
      // chunks 较多（>100）：使用中等批次
      BATCH_SIZE = 30;
    } else {
      // 正常情况：使用正常批次
      BATCH_SIZE = 50;
    }
    
    // 记录内存使用情况（如果可用）
    let initialMemoryUsage = null;
    if (process.memoryUsage) {
      initialMemoryUsage = process.memoryUsage();
      logger.info(`[uploadVectors] 开始向量化前内存: heapUsed=${(initialMemoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB, heapTotal=${(initialMemoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`);
    }
    
    logger.info(`[uploadVectors] 文件大小: ${(file.size / 1024 / 1024).toFixed(2)}MB, chunks数量: ${chunks.length}, 使用批次大小: ${BATCH_SIZE}`);
    let totalProcessed = 0;
    let totalFailed = 0;
    let firstBatchChunks = [];
    let firstBatchEmbeddings = [];

    logger.info(`[uploadVectors] 开始分批向量化和存储（批次大小: ${BATCH_SIZE}）`);

    for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
      const batchChunks = chunks.slice(batchStart, batchEnd);
      const batchEmbeddings = [];
      const validBatchChunks = [];

      logger.info(`[uploadVectors] 处理批次 ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (chunks ${batchStart + 1}-${batchEnd})`);

      // 2.1 向量化当前批次（逐个处理，避免同时处理太多导致内存峰值）
      for (let i = 0; i < batchChunks.length; i++) {
        const chunkIndex = batchStart + i;
        let embedding = null;
        try {
          embedding = await embeddingService.embedText(batchChunks[i].text, userId);
          if (embedding && Array.isArray(embedding)) {
            batchEmbeddings.push(embedding);
            validBatchChunks.push(batchChunks[i]);
            // 立即清理 chunk 文本引用（如果可能）
            // 注意：由于 chunk 对象还在使用，不能直接设置为 null
            // 但 embedding 已经保存，chunk.text 的引用可以减少
          } else {
            logger.warn(`[uploadVectors] 文本块 ${chunkIndex} 向量化失败，跳过`);
            totalFailed++;
          }
        } catch (embedError) {
          logger.warn(`[uploadVectors] 文本块 ${chunkIndex} 向量化失败:`, embedError.message);
          totalFailed++;
        } finally {
          // 显式清理 embedding 引用（虽然已经 push 到数组）
          embedding = null;
          
          // 每处理几个chunks就触发GC，避免内存累积
          // 对于大量chunks的情况，更频繁的GC有助于及时释放内存
          if (global.gc && (i + 1) % 5 === 0) {
            global.gc();
          }
        }
      }

      if (validBatchChunks.length === 0) {
        logger.warn(`[uploadVectors] 批次 ${Math.floor(batchStart / BATCH_SIZE) + 1} 所有文本块向量化失败，跳过`);
        continue;
      }

      // 2.2 存储当前批次到向量数据库
      try {
        // 如果是第一批，先删除可能存在的旧数据（避免重复）
        // storeFileVectors 内部也会删除，但提前删除可以避免不必要的处理
        if (batchStart === 0) {
          try {
            await vectorDBService.deleteFileVectors(file_id);
            logger.info(`[uploadVectors] 已清理旧的文件向量数据: fileId=${file_id}`);
          } catch (deleteError) {
            // 忽略删除错误（可能文件不存在）
            logger.debug(`[uploadVectors] 清理旧数据时出错（可忽略）:`, deleteError.message);
          }
        }

        // 使用 storeFileVectors 存储当前批次
        // 注意：storeFileVectors 会在开始时删除该文件的所有旧数据
        // 所以我们需要修改逻辑，只在第一批时删除，后续批次使用增量插入
        
        // 准备 chunks 数据（避免在 map 中创建过多临时对象）
        const preparedChunks = [];
        for (let idx = 0; idx < validBatchChunks.length; idx++) {
          const chunk = validBatchChunks[idx];
          preparedChunks.push({
            text: chunk.text || chunk,
            metadata: {
              ...(chunk.metadata || {}),
              file_id,
              filename,
              entity_id: entity_id || null,
            },
          });
        }
        
        if (batchStart === 0) {
          // 第一批：正常调用 storeFileVectors（会删除旧数据）
          await vectorDBService.storeFileVectors({
            fileId: file_id,
            userId: userId.toString(),
            entityId: entity_id || null,
            chunks: preparedChunks,
            embeddings: batchEmbeddings,
          });
        } else {
          // 后续批次：使用增量插入（不删除旧数据）
          await vectorDBService.storeFileVectorsIncremental({
            fileId: file_id,
            userId: userId.toString(),
            entityId: entity_id || null,
            chunks: preparedChunks,
            embeddings: batchEmbeddings,
            startChunkIndex: batchStart, // 从当前批次索引开始
          });
        }
        
        // 清理 preparedChunks（虽然函数结束后会自动回收）
        preparedChunks.length = 0;

        totalProcessed += validBatchChunks.length;
        logger.info(`[uploadVectors] 批次 ${Math.floor(batchStart / BATCH_SIZE) + 1} 完成: ${validBatchChunks.length} 个chunks已存储`);

        // 保存第一批数据用于后续可能的错误处理（仅保存最小必要数据）
        if (batchStart === 0 && validBatchChunks.length > 0) {
          // 只保存第一个 chunk 和 embedding，而不是整个数组
          firstBatchChunks = [validBatchChunks[0]];
          firstBatchEmbeddings = [batchEmbeddings[0]];
        }

        // 强制垃圾回收（如果可用）- 每批都执行，确保及时释放内存
        if (global.gc) {
          global.gc();
          
          // 记录内存使用情况
          if (process.memoryUsage) {
            const memUsage = process.memoryUsage();
            logger.info(`[uploadVectors] 批次 ${Math.floor(batchStart / BATCH_SIZE) + 1} 完成后内存: heapUsed=${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB, heapTotal=${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`);
          }
        }
      } catch (storeError) {
        logger.error(`[uploadVectors] 批次 ${Math.floor(batchStart / BATCH_SIZE) + 1} 存储失败:`, storeError);
        // 如果存储失败，继续处理下一批（部分成功总比全部失败好）
      }

      // 清理当前批次的数据，释放内存
      // 显式清空数组，帮助 GC 识别可回收对象
      batchChunks.length = 0;
      batchEmbeddings.length = 0;
      validBatchChunks.length = 0;
      
      // 对于大文件，在每批处理后强制 GC（如果可用）
      // 注意：频繁 GC 可能影响性能，但可以防止内存泄漏
      if (global.gc && chunks.length > 200 && batchStart % (BATCH_SIZE * 2) === 0) {
        global.gc();
      }
    }

    if (totalProcessed === 0) {
      logger.warn('[uploadVectors] 所有文本块向量化或存储失败');
      return {
        bytes: file.size,
        filename: filename,
        filepath: FileSources.vectordb,
        embedded: false,
      };
    }

    // 记录最终内存使用情况
    if (process.memoryUsage && initialMemoryUsage) {
      const finalMemoryUsage = process.memoryUsage();
      const memoryIncrease = finalMemoryUsage.heapUsed - initialMemoryUsage.heapUsed;
      logger.info(`[uploadVectors] 向量化完成内存: heapUsed=${(finalMemoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB, 增加=${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
    }
    
    logger.info(`[uploadVectors] 文件向量化完成: fileId=${file_id}, 成功处理 ${totalProcessed} 个chunks, 失败 ${totalFailed} 个`);

    return {
      bytes: file.size,
      filename: filename, // 使用解码后的文件名
      filepath: FileSources.vectordb,
      embedded: true,
    };
  } catch (error) {
    logger.error('[uploadVectors] 文件向量化失败:', error);
    // 不抛出错误，允许文件上传继续（文件已存储，只是向量化失败）
    // 确保返回的文件名也是修复后的
    const errorFilename = fixFilenameEncoding(file.originalname);
    return {
      bytes: file.size,
      filename: errorFilename,
      filepath: FileSources.vectordb,
      embedded: false,
    };
  }
}

module.exports = {
  deleteVectors,
  uploadVectors,
};
