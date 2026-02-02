const sharp = require('sharp');

/**
 * Determines the file type of a buffer
 * @param {Buffer} dataBuffer
 * @param {boolean} [returnFileType=false] - Optional. If true, returns the file type instead of the file extension.
 * @returns {Promise<string|null|import('file-type').FileTypeResult>} - Returns the file extension if found, else null
 * */
const determineFileType = async (dataBuffer, returnFileType) => {
  const fileType = await import('file-type');
  const type = await fileType.fileTypeFromBuffer(dataBuffer);
  if (returnFileType) {
    return type;
  }
  return type ? type.ext : null; // Returns extension if found, else null
};

/**
 * Get buffer metadata
 * @param {Buffer} buffer
 * @returns {Promise<{ bytes: number, type: string, dimensions: Record<string, number>, extension: string}>}
 */
const getBufferMetadata = async (buffer) => {
  const fileType = await determineFileType(buffer, true);
  const bytes = buffer.length;
  let extension = fileType ? fileType.ext : 'unknown';

  /** @type {Record<string, number>} */
  let dimensions = {};

  if (fileType && fileType.mime.startsWith('image/') && extension !== 'unknown') {
    const imageMetadata = await sharp(buffer).metadata();
    dimensions = {
      width: imageMetadata.width,
      height: imageMetadata.height,
    };
  }

  return {
    bytes,
    type: fileType?.mime ?? 'unknown',
    dimensions,
    extension,
  };
};

/**
 * Removes UUID prefix from filename for clean display
 * Pattern: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx__filename.ext
 * @param {string} fileName - The filename to clean
 * @returns {string} - The cleaned filename without UUID prefix
 */
const cleanFileName = (fileName) => {
  if (!fileName) {
    return fileName;
  }

  // Remove UUID pattern: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx__
  const cleaned = fileName.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__/i,
    '',
  );

  return cleaned;
};

/**
 * 修复文件名编码问题
 * Node.js multer 经常将 UTF-8 文件名错误地按 Latin1 解码
 * 这个函数将 Latin1 编码的字符串重新解码为 UTF-8
 * 
 * @param {string} name - 可能被错误解码的文件名
 * @returns {string} 修复后的文件名
 */
function fixFilenameEncoding(name) {
  if (!name || typeof name !== 'string') {
    return name || '';
  }

  try {
    // 检查是否包含乱码字符（Latin1 错误解码的特征）
    // 如果文件名包含大量非 ASCII 字符且看起来像乱码，尝试修复
    const hasGarbledChars = /[^\x00-\x7F]/.test(name) && /[à-ÿ]/.test(name);
    
    if (hasGarbledChars) {
      // 尝试将 Latin1 编码的字符串重新解码为 UTF-8
      // 这是 Node.js multer 的常见问题：UTF-8 文件名被当成 Latin1 读取
      const fixed = Buffer.from(name, 'latin1').toString('utf8');
      // 验证修复后的字符串是否包含有效的中文字符
      if (/[\u4e00-\u9fa5]/.test(fixed)) {
        return fixed;
      }
    }
    
    // 如果已经是正确的 UTF-8 或修复失败，返回原始名称
    return name;
  } catch (error) {
    // 如果转换失败，返回原始名称
    const { logger } = require('@aipyq/data-schemas');
    logger.warn(`[fixFilenameEncoding] 文件名编码修复失败: ${name}`, error.message);
    return name;
  }
}

module.exports = { determineFileType, getBufferMetadata, cleanFileName, fixFilenameEncoding };
