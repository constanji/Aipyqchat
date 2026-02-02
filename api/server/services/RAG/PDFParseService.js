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

class PDFParseService {
  constructor() {
    this.pdfParse = null;
    this.PDFLoader = null;
    this.useLangChain = false;
    this.initialized = false;
  }

  /**
   * 初始化PDF解析库
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // 优先使用 pdf-parse
    try {
      this.pdfParse = require("pdf-parse");
      this.useLangChain = false;
      this.initialized = true;
      logger.info("[PDFParseService] pdf-parse 作为主解析器");
      return;
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") {
        logger.warn("[PDFParseService] pdf-parse 加载失败:", error.message);
      }
    }

    // 回退到 LangChain PDFLoader
    try {
      const {
        PDFLoader,
      } = require("@langchain/community/document_loaders/fs/pdf");
      this.PDFLoader = PDFLoader;
      this.useLangChain = true;
      this.initialized = true;
      logger.warn("[PDFParseService] 使用 LangChain PDFLoader");
    } catch (langchainError) {
      throw new Error("PDF解析库未安装。请安装：npm install pdf-parse");
    }
  }

  /**
   * 清理文本：移除危险字符
   */
  sanitizeText(text) {
    if (!text) return "";
    return text
      .replace(/\u0000/g, "")
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\uFFFD/g, "");
  }

  /**
   * 检测PDF类型
   */
  detectPDFType(text) {
    if (!text) return "image";
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("%PDF")) return "image";
    const letters = (trimmed.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters < 200) return "image";
    if (letters / trimmed.length < 0.1) return "hybrid";
    return "text";
  }

  /**
   * 解析PDF文本
   */
  async parseTextPDF(pdfPathOrBuffer) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.useLangChain && this.PDFLoader) {
      return await this.parseWithLangChain(pdfPathOrBuffer);
    }
    return await this.parseWithPdfParse(pdfPathOrBuffer);
  }

  /**
   * 使用 LangChain PDFLoader 解析
   */
  async parseWithLangChain(pdfPathOrBuffer) {
    const path = require("path");
    const os = require("os");
    let pdfPath;
    let isTemp = false;

    if (Buffer.isBuffer(pdfPathOrBuffer)) {
      pdfPath = path.join(os.tmpdir(), `pdf_${Date.now()}.pdf`);
      fs.writeFileSync(pdfPath, pdfPathOrBuffer);
      isTemp = true;
    } else {
      pdfPath = pdfPathOrBuffer;
    }

    try {
      const loader = new this.PDFLoader(pdfPath);
      const documents = await loader.load();

      if (!documents || documents.length === 0) {
        throw new Error("PDFLoader 返回空文档");
      }

      const texts = documents.map((doc) => doc.pageContent || "");
      const fullText = texts.join("\n\n");

      return {
        text: fullText,
        pages: documents.length,
        metadata: { parse_method: "langchain-pdfloader", pdf_type: "text" },
      };
    } finally {
      if (isTemp && fs.existsSync(pdfPath)) {
        try {
          fs.unlinkSync(pdfPath);
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  /**
   * 使用 pdf-parse 解析
   */
  async parseWithPdfParse(pdfPathOrBuffer) {
    let buffer;
    if (Buffer.isBuffer(pdfPathOrBuffer)) {
      buffer = pdfPathOrBuffer;
    } else {
      buffer = fs.readFileSync(pdfPathOrBuffer);
    }

    const data = await this.pdfParse(buffer);

    return {
      text: data.text || "",
      pages: data.numpages || 1,
      metadata: { parse_method: "pdf-parse", pdf_type: "text" },
    };
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
   * 解析PDF文件（主入口）
   *
   * @param {string|Buffer} pdfPathOrBuffer - PDF文件路径或Buffer
   * @param {Object} options - 解析选项
   * @returns {Promise<Array<{text: string, metadata: Object}>>} 文本块数组
   */
  async parsePDF(pdfPathOrBuffer, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    // 配置参数
    const MAX_TEXT_SIZE = 5 * 1024 * 1024; // 5MB 文本上限
    const MAX_CHUNKS = 300; // 最大分块数
    const { chunkSize = 1000, chunkOverlap = 150, fileMetadata = {} } = options;

    try {
      // 1. 解析PDF
      logger.info("[PDFParseService] 开始解析PDF文件");
      const parseResult = await this.parseTextPDF(pdfPathOrBuffer);

      // 2. 记录原始大小
      const rawSize = parseResult.text ? parseResult.text.length : 0;
      logger.info(
        `[PDFParseService] 原始文本大小: ${rawSize} 字符 (${(rawSize / 1024 / 1024).toFixed(2)} MB)`,
      );

      // 3. 截断过大的文本
      let text = parseResult.text || "";
      if (text.length > MAX_TEXT_SIZE) {
        logger.warn(
          `[PDFParseService] 文本过大，截断到 ${MAX_TEXT_SIZE / 1024 / 1024} MB`,
        );
        text = text.substring(0, MAX_TEXT_SIZE);
      }

      // 4. 清理文本
      logger.info("[PDFParseService] 清理文本");
      text = this.sanitizeText(text);
      text = this.cleanText(text);
      logger.info(`[PDFParseService] 清理后文本大小: ${text.length} 字符`);

      // 5. 检测类型
      const pdfType = this.detectPDFType(text);
      logger.info(`[PDFParseService] PDF类型: ${pdfType}`);

      // 6. 使用安全的分块方法
      logger.info(
        `[PDFParseService] 开始分块: chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`,
      );
      const rawChunks = TextChunker.chunk(
        text,
        chunkSize,
        chunkOverlap,
        MAX_CHUNKS,
      );

      // 7. 构建最终结果
      const chunks = [];
      const totalPages = parseResult.pages || 1;
      const textLength = text.length;

      for (let i = 0; i < rawChunks.length; i++) {
        const chunk = rawChunks[i];
        const cleanedText = this.sanitizeText(chunk.text);

        if (cleanedText.length > 0) {
          const estimatedPage =
            Math.floor(chunk.start / (textLength / totalPages)) + 1;

          chunks.push({
            text: cleanedText,
            metadata: {
              ...fileMetadata,
              chunk_index: chunks.length,
              page_start: estimatedPage,
              page_end: estimatedPage,
              pages: totalPages,
              pdf_type: pdfType,
              source: "pdf",
              parse_method: parseResult.metadata.parse_method,
            },
          });
        }
      }

      logger.info(`[PDFParseService] PDF解析完成: ${chunks.length} 个块`);
      return chunks;
    } catch (error) {
      logger.error("[PDFParseService] PDF解析失败:", error);
      throw error;
    }
  }
}

module.exports = PDFParseService;
