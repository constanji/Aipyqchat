const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const { EnvVar } = require('@aipyq/agents');
const { logger } = require('@aipyq/data-schemas');
const {
  Time,
  isUUID,
  CacheKeys,
  FileSources,
  ResourceType,
  EModelEndpoint,
  PermissionBits,
  checkOpenAIStorage,
  isAssistantsEndpoint,
} = require('@aipyq/data-provider');
const {
  filterFile,
  processFileUpload,
  processDeleteRequest,
  processAgentFileUpload,
} = require('~/server/services/Files/process');
const { fileAccess } = require('~/server/middleware/accessResources/fileAccess');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { getOpenAIClient } = require('~/server/controllers/assistants/helpers');
const { checkPermission } = require('~/server/services/PermissionService');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { refreshS3FileUrls } = require('~/server/services/Files/S3/crud');
const { hasAccessToFilesViaAgent } = require('~/server/services/Files');
const { getFiles, batchUpdateFiles } = require('~/models/File');
const { cleanFileName, fixFilenameEncoding } = require('~/server/utils/files');
const { getAssistant } = require('~/models/Assistant');
const { getAgent } = require('~/models/Agent');
const { getLogStores } = require('~/cache');
const { Readable } = require('stream');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const appConfig = req.config;
    const files = await getFiles({ user: req.user.id });
    if (appConfig.fileStrategy === FileSources.s3) {
      try {
        const cache = getLogStores(CacheKeys.S3_EXPIRY_INTERVAL);
        const alreadyChecked = await cache.get(req.user.id);
        if (!alreadyChecked) {
          await refreshS3FileUrls(files, batchUpdateFiles);
          await cache.set(req.user.id, true, Time.THIRTY_MINUTES);
        }
      } catch (error) {
        logger.warn('[/files] Error refreshing S3 file URLs:', error);
      }
    }
    res.status(200).send(files);
  } catch (error) {
    logger.error('[/files] Error getting files:', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

/**
 * Get files specific to an agent
 * @route GET /files/agent/:agent_id
 * @param {string} agent_id - The agent ID to get files for
 * @returns {Promise<TFile[]>} Array of files attached to the agent
 */
router.get('/agent/:agent_id', async (req, res) => {
  try {
    const { agent_id } = req.params;
    const userId = req.user.id;

    if (!agent_id) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    const agent = await getAgent({ id: agent_id });
    if (!agent) {
      return res.status(200).json([]);
    }

    if (agent.author.toString() !== userId) {
      const hasEditPermission = await checkPermission({
        userId,
        role: req.user.role,
        resourceType: ResourceType.AGENT,
        resourceId: agent._id,
        requiredPermission: PermissionBits.EDIT,
      });

      if (!hasEditPermission) {
        return res.status(200).json([]);
      }
    }

    const agentFileIds = [];
    if (agent.tool_resources) {
      for (const [, resource] of Object.entries(agent.tool_resources)) {
        if (resource?.file_ids && Array.isArray(resource.file_ids)) {
          agentFileIds.push(...resource.file_ids);
        }
      }
    }

    if (agentFileIds.length === 0) {
      return res.status(200).json([]);
    }

    const files = await getFiles({ file_id: { $in: agentFileIds } }, null, { text: 0 });

    res.status(200).json(files);
  } catch (error) {
    logger.error('[/files/agent/:agent_id] Error fetching agent files:', error);
    res.status(500).json({ error: 'Failed to fetch agent files' });
  }
});

router.get('/config', async (req, res) => {
  try {
    const appConfig = req.config;
    res.status(200).json(appConfig.fileConfig);
  } catch (error) {
    logger.error('[/files] Error getting fileConfig', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { files: _files } = req.body;

    /** @type {MongoFile[]} */
    const files = _files.filter((file) => {
      if (!file.file_id) {
        return false;
      }
      if (!file.filepath) {
        return false;
      }

      if (/^(file|assistant)-/.test(file.file_id)) {
        return true;
      }

      return isUUID.safeParse(file.file_id).success;
    });

    if (files.length === 0) {
      res.status(204).json({ message: 'Nothing provided to delete' });
      return;
    }

    const fileIds = files.map((file) => file.file_id);
    const dbFiles = await getFiles({ file_id: { $in: fileIds } });

    const ownedFiles = [];
    const nonOwnedFiles = [];

    for (const file of dbFiles) {
      if (file.user.toString() === req.user.id.toString()) {
        ownedFiles.push(file);
      } else {
        nonOwnedFiles.push(file);
      }
    }

    if (nonOwnedFiles.length === 0) {
      await processDeleteRequest({ req, files: ownedFiles });
      logger.debug(
        `[/files] Files deleted successfully: ${ownedFiles
          .filter((f) => f.file_id)
          .map((f) => f.file_id)
          .join(', ')}`,
      );
      res.status(200).json({ message: 'Files deleted successfully' });
      return;
    }

    let authorizedFiles = [...ownedFiles];
    let unauthorizedFiles = [];

    if (req.body.agent_id && nonOwnedFiles.length > 0) {
      const nonOwnedFileIds = nonOwnedFiles.map((f) => f.file_id);
      const accessMap = await hasAccessToFilesViaAgent({
        userId: req.user.id,
        role: req.user.role,
        fileIds: nonOwnedFileIds,
        agentId: req.body.agent_id,
        isDelete: true,
      });

      for (const file of nonOwnedFiles) {
        if (accessMap.get(file.file_id)) {
          authorizedFiles.push(file);
        } else {
          unauthorizedFiles.push(file);
        }
      }
    } else {
      unauthorizedFiles = nonOwnedFiles;
    }

    if (unauthorizedFiles.length > 0) {
      return res.status(403).json({
        message: 'You can only delete files you have access to',
        unauthorizedFiles: unauthorizedFiles.map((f) => f.file_id),
      });
    }

    /* Handle agent unlinking even if no valid files to delete */
    if (req.body.agent_id && req.body.tool_resource && dbFiles.length === 0) {
      const agent = await getAgent({
        id: req.body.agent_id,
      });

      const toolResourceFiles = agent.tool_resources?.[req.body.tool_resource]?.file_ids ?? [];
      const agentFiles = files.filter((f) => toolResourceFiles.includes(f.file_id));

      await processDeleteRequest({ req, files: agentFiles });
      res.status(200).json({ message: 'File associations removed successfully from agent' });
      return;
    }

    /* Handle assistant unlinking even if no valid files to delete */
    if (req.body.assistant_id && req.body.tool_resource && dbFiles.length === 0) {
      const assistant = await getAssistant({
        id: req.body.assistant_id,
      });

      const toolResourceFiles = assistant.tool_resources?.[req.body.tool_resource]?.file_ids ?? [];
      const assistantFiles = files.filter((f) => toolResourceFiles.includes(f.file_id));

      await processDeleteRequest({ req, files: assistantFiles });
      res.status(200).json({ message: 'File associations removed successfully from assistant' });
      return;
    } else if (
      req.body.assistant_id &&
      req.body.files?.[0]?.filepath === EModelEndpoint.azureAssistants
    ) {
      await processDeleteRequest({ req, files: req.body.files });
      return res
        .status(200)
        .json({ message: 'File associations removed successfully from Azure Assistant' });
    }

    await processDeleteRequest({ req, files: authorizedFiles });

    logger.debug(
      `[/files] Files deleted successfully: ${authorizedFiles
        .filter((f) => f.file_id)
        .map((f) => f.file_id)
        .join(', ')}`,
    );
    res.status(200).json({ message: 'Files deleted successfully' });
  } catch (error) {
    logger.error('[/files] Error deleting files:', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

function isValidID(str) {
  return /^[A-Za-z0-9_-]{21}$/.test(str);
}

router.get('/code/download/:session_id/:fileId', async (req, res) => {
  try {
    const { session_id, fileId } = req.params;
    const logPrefix = `Session ID: ${session_id} | File ID: ${fileId} | Code output download requested by user `;
    logger.debug(logPrefix);

    if (!session_id || !fileId) {
      return res.status(400).send('Bad request');
    }

    if (!isValidID(session_id) || !isValidID(fileId)) {
      logger.debug(`${logPrefix} invalid session_id or fileId`);
      return res.status(400).send('Bad request');
    }

    const { getDownloadStream } = getStrategyFunctions(FileSources.execute_code);
    if (!getDownloadStream) {
      logger.warn(
        `${logPrefix} has no stream method implemented for ${FileSources.execute_code} source`,
      );
      return res.status(501).send('Not Implemented');
    }

    const result = await loadAuthValues({ userId: req.user.id, authFields: [EnvVar.CODE_API_KEY] });

    /** @type {AxiosResponse<ReadableStream> | undefined} */
    const response = await getDownloadStream(
      `${session_id}/${fileId}`,
      result[EnvVar.CODE_API_KEY],
    );
    res.set(response.headers);
    response.data.pipe(res);
  } catch (error) {
    logger.error('Error downloading file:', error);
    res.status(500).send('Error downloading file');
  }
});

/**
 * Get file content (for text files only)
 * @route GET /files/content/:userId/:file_id
 */
router.get('/content/:userId/:file_id', fileAccess, async (req, res) => {
  try {
    const { userId, file_id } = req.params;
    logger.debug(`File content requested by user ${userId}: ${file_id}`);

    // Access already validated by fileAccess middleware
    const file = req.fileAccess.file;

    // 支持的文件类型：文本文件、PDF、Word
    const textMimeTypes = ['text/plain', 'text/markdown', 'text/html', 'application/json'];
    const textExtensions = ['.txt', '.md', '.html', '.json', '.js', '.ts', '.jsx', '.tsx', '.css', '.xml'];
    const pdfExtensions = ['.pdf'];
    const wordExtensions = ['.doc', '.docx'];
    const fileExt = require('path').extname(file.filename).toLowerCase();
    const isTextFile = textMimeTypes.includes(file.type) || textExtensions.includes(fileExt);
    const isPDF = file.type === 'application/pdf' || pdfExtensions.includes(fileExt);
    const isWord = file.type === 'application/msword' || 
                   file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                   wordExtensions.includes(fileExt);
    
    if (!isTextFile && !isPDF && !isWord) {
      return res.status(400).json({ 
        error: 'Unsupported file type',
        message: 'Only text files, PDF, and Word documents can be viewed as content' 
      });
    }

    // 对于本地文件，直接读取
    if (file.source === FileSources.local && file.filepath) {
      try {
        // 将相对路径转换为绝对路径
        let absoluteFilePath = file.filepath;
        if (file.filepath.startsWith('/uploads/')) {
          const appConfig = req.config;
          const basePath = file.filepath.split('/uploads/')[1];
          if (basePath) {
            absoluteFilePath = path.join(appConfig.paths.uploads, basePath);
          }
        } else if (file.filepath.startsWith('/images/')) {
          const appConfig = req.config;
          const basePath = file.filepath.split('/images/')[1];
          if (basePath) {
            absoluteFilePath = path.join(appConfig.paths.imageOutput, basePath);
          }
        }
        
        let content = '';
        
        // PDF 文件：解析并显示文本内容
        if (isPDF) {
          const PDFParseService = require('~/server/services/RAG/PDFParseService');
          const pdfParseService = new PDFParseService();
          await pdfParseService.initialize();
          const chunks = await pdfParseService.parsePDF(absoluteFilePath, {
            chunkSize: 10000, // 使用较大的 chunk size 以获取完整内容
            chunkOverlap: 0,
          });
          // 合并所有 chunks 的文本
          content = chunks.map(chunk => chunk.text || chunk).join('\n\n');
        }
        // Word 文件：解析并显示文本内容
        else if (isWord) {
          const WordParseService = require('~/server/services/RAG/WordParseService');
          const wordParseService = new WordParseService();
          await wordParseService.initialize();
          const chunks = await wordParseService.parseWordDocument(absoluteFilePath, {
            chunkSize: 10000, // 使用较大的 chunk size 以获取完整内容
            chunkOverlap: 0,
          });
          // 合并所有 chunks 的文本
          content = chunks.map(chunk => chunk.text || chunk).join('\n\n');
        }
        // 文本文件：直接读取
        else {
          const { readFileAsString } = require('@aipyq/api');
          const result = await readFileAsString(absoluteFilePath, {
            fileSize: file.bytes,
          });
          content = result.content;
        }
        
        // 修复文件名编码问题
        const fixedFilename = fixFilenameEncoding(file.filename);
        return res.status(200).json({
          content,
          filename: fixedFilename,
          type: file.type,
          size: file.bytes,
        });
      } catch (readError) {
        logger.error('[CONTENT ROUTE] Error reading file:', readError);
        return res.status(500).json({ 
          error: 'Failed to read file',
          message: readError.message 
        });
      }
    }

    // 对于其他存储源，尝试获取流并读取
    const { getDownloadStream } = getStrategyFunctions(file.source);
    if (!getDownloadStream) {
      return res.status(501).json({ 
        error: 'Not Implemented',
        message: `Content viewing not supported for storage source: ${file.source}` 
      });
    }

    if (checkOpenAIStorage(file.source)) {
      req.body = { model: file.model };
      const endpointMap = {
        [FileSources.openai]: EModelEndpoint.assistants,
        [FileSources.azure]: EModelEndpoint.azureAssistants,
      };
      const { openai } = await getOpenAIClient({
        req,
        res,
        overrideEndpoint: endpointMap[file.source],
      });
      const passThrough = await getDownloadStream(file_id, openai);
      const stream =
        passThrough.body && typeof passThrough.body.getReader === 'function'
          ? Readable.fromWeb(passThrough.body)
          : passThrough.body;
      
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks).toString('utf8');
      
      return res.status(200).json({
        content,
        filename: file.filename,
        type: file.type,
        size: file.bytes,
      });
    } else {
      const fileStream = await getDownloadStream(req, file.filepath);
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks).toString('utf8');
      
      return res.status(200).json({
        content,
        filename: file.filename,
        type: file.type,
        size: file.bytes,
      });
    }
  } catch (error) {
    logger.error('[CONTENT ROUTE] Error getting file content:', error);
    res.status(500).json({ 
      error: 'Failed to get file content',
      message: error.message 
    });
  }
});

router.get('/download/:userId/:file_id', fileAccess, async (req, res) => {
  try {
    const { userId, file_id } = req.params;
    logger.debug(`File download requested by user ${userId}: ${file_id}`);

    // Access already validated by fileAccess middleware
    const file = req.fileAccess.file;

    if (checkOpenAIStorage(file.source) && !file.model) {
      logger.warn(`File download requested by user ${userId} has no associated model: ${file_id}`);
      return res.status(400).send('The model used when creating this file is not available');
    }

    const { getDownloadStream } = getStrategyFunctions(file.source);
    if (!getDownloadStream) {
      logger.warn(
        `File download requested by user ${userId} has no stream method implemented: ${file.source}`,
      );
      return res.status(501).send('Not Implemented');
    }

    const setHeaders = () => {
      // 修复文件名编码问题
      const fixedFilename = fixFilenameEncoding(file.filename);
      const cleanedFilename = cleanFileName(fixedFilename);
      res.setHeader('Content-Disposition', `attachment; filename="${cleanedFilename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-File-Metadata', JSON.stringify(file));
    };

    if (checkOpenAIStorage(file.source)) {
      req.body = { model: file.model };
      const endpointMap = {
        [FileSources.openai]: EModelEndpoint.assistants,
        [FileSources.azure]: EModelEndpoint.azureAssistants,
      };
      const { openai } = await getOpenAIClient({
        req,
        res,
        overrideEndpoint: endpointMap[file.source],
      });
      logger.debug(`Downloading file ${file_id} from OpenAI`);
      const passThrough = await getDownloadStream(file_id, openai);
      setHeaders();
      logger.debug(`File ${file_id} downloaded from OpenAI`);

      // Handle both Node.js and Web streams
      const stream =
        passThrough.body && typeof passThrough.body.getReader === 'function'
          ? Readable.fromWeb(passThrough.body)
          : passThrough.body;

      stream.pipe(res);
    } else {
      const fileStream = await getDownloadStream(req, file.filepath);

      fileStream.on('error', (streamError) => {
        logger.error('[DOWNLOAD ROUTE] Stream error:', streamError);
      });

      setHeaders();
      fileStream.pipe(res);
    }
  } catch (error) {
    logger.error('[DOWNLOAD ROUTE] Error downloading file:', error);
    res.status(500).send('Error downloading file');
  }
});

router.post('/', async (req, res) => {
  const metadata = req.body;
  let cleanup = true;

  try {
    // 检查文件是否存在
    if (!req.file) {
      throw new Error('No file uploaded');
    }

    // 确保 file_id 已设置（multer 的 filename 回调应该已经设置）
    // 如果没有设置，可能是 multer 中间件没有正确执行
    if (!req.file_id) {
      // 如果 file_id 未设置，尝试从 metadata 中获取，或者生成一个新的
      if (metadata.file_id) {
        req.file_id = metadata.file_id;
      } else {
        // 生成一个新的 file_id
        const crypto = require('crypto');
        req.file_id = crypto.randomUUID();
        logger.warn('[/files] file_id was not set by multer, generated new one:', req.file_id);
      }
    }

    // 将 req.file_id 也设置到 req.body.file_id，因为 filterFile 检查的是 req.body.file_id
    if (!req.body.file_id) {
      req.body.file_id = req.file_id;
    }

    filterFile({ req });

    metadata.temp_file_id = metadata.file_id;
    metadata.file_id = req.file_id;

    if (isAssistantsEndpoint(metadata.endpoint)) {
      return await processFileUpload({ req, res, metadata });
    }

    return await processAgentFileUpload({ req, res, metadata });
  } catch (error) {
    let message = 'Error processing file';
    logger.error('[/files] Error processing file:', error);

    if (error.message?.includes('file_ids')) {
      message += ': ' + error.message;
    }

    if (
      error.message?.includes('Invalid file format') ||
      error.message?.includes('No OCR result') ||
      error.message?.includes('exceeds token limit')
    ) {
      message = error.message;
    }

    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
        cleanup = false;
      } catch (error) {
        logger.error('[/files] Error deleting file:', error);
      }
    }
    res.status(500).json({ message });
  } finally {
    if (cleanup && req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (error) {
        logger.error('[/files] Error deleting file after file processing:', error);
      }
    } else {
      logger.debug('[/files] File processing completed without cleanup');
    }
  }
});

module.exports = router;
