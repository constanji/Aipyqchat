const fs = require("fs");
const { logger } = require("@aipyq/data-schemas");

/**
 * 通用文本分块工具
 */
class TextChunker {
  /**
   * 安全的文本分块方法
   * @param {string} text - 要分块的文本
   * @param {number} chunkSize - 块大小
   * @param {number} chunkOverlap - 重叠大小
   * @param {number} maxChunks - 最大分块数
   * @returns {Array<{start: number, end: number, text: string}>} 分块结果
   */
  static chunk(text, chunkSize = 1000, chunkOverlap = 150, maxChunks = 500) {
    if (!text || text.length === 0) {
      return [];
    }

    const textLength = text.length;
    const effectiveStep = Math.max(1, chunkSize - chunkOverlap); // 确保至少前进1个字符

    // 预计算最大可能的分块数量
    const estimatedChunks = Math.ceil(textLength / effectiveStep);
    const safeMaxChunks = Math.min(estimatedChunks, maxChunks);

    const chunks = [];

    // 使用 for 循环，有明确的终止条件
    for (let i = 0; i < safeMaxChunks; i++) {
      const start = i * effectiveStep;

      // 边界检查
      if (start >= textLength) {
        break;
      }

      let end = Math.min(start + chunkSize, textLength);

      // 尝试在分隔符处断开（只在非最后一块时）
      if (end < textLength) {
        const adjustedEnd = TextChunker.findBreakPoint(text, start, end);
        if (adjustedEnd > start) {
          end = adjustedEnd;
        }
      }

      const chunkText = text.substring(start, end).trim();

      if (chunkText.length > 0) {
        chunks.push({
          start,
          end,
          text: chunkText,
        });
      }
    }

    return chunks;
  }

  /**
   * 查找合适的断点位置
   * @param {string} text - 完整文本
   * @param {number} start - 开始位置
   * @param {number} end - 结束位置
   * @returns {number} 调整后的结束位置
   */
  static findBreakPoint(text, start, end) {
    const searchStart = start + Math.floor((end - start) * 0.5); // 从中间开始搜索
    const separators = ["\n\n", "\n", "。", ". ", "！", "？", "；", "，", " "];

    // 从 end 向 searchStart 查找分隔符
    for (const sep of separators) {
      const lastPos = text.lastIndexOf(sep, end - 1);
      if (lastPos >= searchStart) {
        return lastPos + sep.length;
      }
    }

    return end; // 未找到分隔符，使用原始结束位置
  }
}

class WordParseService {
  constructor() {
    this.WordExtractor = null;
    this.initialized = false;
    this.useWordExtractor = false;
  }

  /**
   * 初始化Word解析库
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.WordExtractor = require("word-extractor");
      this.useWordExtractor = true;
      this.initialized = true;
    } catch (error) {
      throw new Error(
        "Word解析库未安装。请运行 'npm install word-extractor' 来安装该依赖。",
      );
    }
  }

  /**
   * 清理文本：移除危险字符
   */
  sanitizeText(text) {
    if (!text) return "";
    return (
      text
        // eslint-disable-next-line no-control-regex
        .replace(/\u0000/g, "")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/\uFFFD/g, "")
    );
  }

  /**
   * 使用 word-extractor 解析 Word 文档
   */
  async parseWithWordExtractor(wordPathOrBuffer) {
    let buffer;
    if (Buffer.isBuffer(wordPathOrBuffer)) {
      buffer = wordPathOrBuffer;
    } else {
      buffer = fs.readFileSync(wordPathOrBuffer);
    }

    const extractor = new this.WordExtractor();
    const extracted = await extractor.extract(buffer);

    if (!extracted) {
      throw new Error("word-extractor 解析失败");
    }

    const text = extracted.getBody() || "";

    // 尝试获取其他内容
    let additionalText = "";
    try {
      const headers = extracted.getHeaders({ includeFooters: false }) || "";
      const footers = extracted.getFooters() || "";
      additionalText = [headers, footers].filter((t) => t.trim()).join("\n\n");
    } catch (e) {
      // 忽略错误
    }

    const fullText = additionalText ? `${additionalText}\n\n${text}` : text;

    return {
      text: fullText,
      metadata: {
        parse_method: "word-extractor",
        word_type: "doc",
      },
    };
  }

  /**
   * 解析Word文档
   */
  async parseWord(wordPathOrBuffer) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (this.useWordExtractor) {
        return await this.parseWithWordExtractor(wordPathOrBuffer);
      }
      throw new Error("没有可用的 Word 解析器");
    } catch (error) {
      throw error;
    }
  }

  /**
   * 清理文本（语义级）
   */
  cleanText(text) {
    if (!text) return "";
    return text
      .replace(/-\n/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/Page\s+\d+/gi, "")
      .replace(/第\s*\d+\s*页/gi, "")
      .replace(/^\d+\s*$/gm, "")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  /**
   * 解析Word文件（主入口）
   *
   * @param {string|Buffer} wordPathOrBuffer - Word文件路径或Buffer
   * @param {Object} options - 解析选项
   * @returns {Promise<Array<{text: string, metadata: Object}>>} 文本块数组
   */
  async parseWordDocument(wordPathOrBuffer, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    // 配置参数
    const MAX_TEXT_SIZE = 5 * 1024 * 1024; // 5MB 文本上限
    const MAX_CHUNKS = 300; // 最大分块数
    const { chunkSize = 1000, chunkOverlap = 150, fileMetadata = {} } = options;

    try {
      // 1. 解析Word
      logger.info("[WordParseService] 开始解析Word文件");
      const parseResult = await this.parseWord(wordPathOrBuffer);

      // 2. 记录原始大小
      const rawSize = parseResult.text ? parseResult.text.length : 0;
      logger.info(
        `[WordParseService] 原始文本大小: ${rawSize} 字符 (${(rawSize / 1024 / 1024).toFixed(2)} MB)`,
      );

      // 3. 截断过大的文本
      let text = parseResult.text || "";
      if (text.length > MAX_TEXT_SIZE) {
        logger.warn(
          `[WordParseService] 文本过大，截断到 ${MAX_TEXT_SIZE / 1024 / 1024} MB`,
        );
        text = text.substring(0, MAX_TEXT_SIZE);
      }

      // 4. 清理文本
      logger.info("[WordParseService] 清理文本");
      text = this.sanitizeText(text);
      text = this.cleanText(text);
      logger.info(`[WordParseService] 清理后文本大小: ${text.length} 字符`);

      // 5. 使用安全的分块方法
      logger.info(
        `[WordParseService] 开始分块: chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`,
      );
      const rawChunks = TextChunker.chunk(
        text,
        chunkSize,
        chunkOverlap,
        MAX_CHUNKS,
      );

      // 6. 构建最终结果
      const chunks = [];

      for (let i = 0; i < rawChunks.length; i++) {
        const chunk = rawChunks[i];
        const cleanedText = this.sanitizeText(chunk.text);

        if (cleanedText.length > 0) {
          chunks.push({
            text: cleanedText,
            metadata: {
              ...fileMetadata,
              ...parseResult.metadata,
              chunk_index: chunks.length,
              source: "word",
            },
          });
        }
      }

      logger.info(`[WordParseService] Word解析完成: ${chunks.length} 个块`);
      return chunks;
    } catch (error) {
      logger.error("[WordParseService] Word解析失败:", error);
      throw error;
    }
  }
}

module.exports = WordParseService;
