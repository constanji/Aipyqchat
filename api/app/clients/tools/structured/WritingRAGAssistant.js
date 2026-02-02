const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('@aipyq/data-schemas');

// 动态导入 RAG 服务
let RAGService;
let KnowledgeType;
try {
  RAGService = require('~/server/services/RAG/RAGService');
  try {
    KnowledgeType = require('@aipyq/data-schemas/schema/knowledgeBase').KnowledgeType;
  } catch (e) {
    try {
      KnowledgeType = require('../../../../packages/data-schemas/src/schema/knowledgeBase').KnowledgeType;
    } catch (e2) {
      // 回退定义
      KnowledgeType = {
        SEMANTIC_MODEL: 'semantic_model',
        QA_PAIR: 'qa_pair',
        SYNONYM: 'synonym',
        BUSINESS_KNOWLEDGE: 'business_knowledge',
        FILE: 'file',
      };
    }
  }
} catch (error) {
  logger.warn('[WritingRAGAssistant] RAG服务未找到，部分功能将不可用:', error.message);
  // 即使 RAG 服务加载失败，也提供 KnowledgeType 回退定义
  KnowledgeType = KnowledgeType || {
    SEMANTIC_MODEL: 'semantic_model',
    QA_PAIR: 'qa_pair',
    SYNONYM: 'synonym',
    BUSINESS_KNOWLEDGE: 'business_knowledge',
    FILE: 'file',
  };
}

/**
 * WritingRAGAssistant Tool - 基于RAG的写作辅助工具
 * 
 * 该工具支持：
 * - /writing_rag.add_reference - 添加参考文献到知识库（向量化存储）
 * - /writing_rag.analyze_style - 分析文献的文风特征（用词、句式、结构等）
 * - /writing_rag.generate_with_style - 基于参考文风生成内容
 * - /writing_rag.search_references - 搜索相关参考文献
 * - /writing_rag.list_references - 列出已存储的参考文献
 */
class WritingRAGAssistant extends Tool {
  name = 'writing_rag';
  description =
    '基于RAG的写作辅助工具，支持存储参考文献、分析文风特征、基于文风生成内容。' +
    'Commands: add_reference (添加参考文献到知识库), analyze_style (分析文献文风特征), ' +
    'generate_with_style (基于参考文风生成内容), search_references (搜索相关参考文献), ' +
    'list_references (列出已存储的参考文献). ' +
    'Use command name and provide arguments as needed.';

  schema = z.object({
    command: z.enum([
      'add_reference',
      'analyze_style',
      'generate_with_style',
      'search_references',
      'list_references',
    ]),
    arguments: z.string().optional().describe('Command arguments'),
    // add_reference 参数
    title: z.string().optional().describe('文献标题'),
    content: z.string().optional().describe('文献内容（文本）'),
    file_id: z.string().optional().describe('文件ID（如果文献来自文件）'),
    filename: z.string().optional().describe('文件名'),
    author: z.string().optional().describe('作者'),
    category: z.string().optional().describe('文献分类（如：学术论文、公文、报告等）'),
    tags: z.string().optional().describe('标签（逗号分隔）'),
    // analyze_style 参数
    reference_id: z.string().optional().describe('要分析的文献ID'),
    reference_content: z.string().optional().describe('要分析的文献内容（直接提供文本）'),
    // generate_with_style 参数
    query: z.string().optional().describe('生成内容的主题或需求描述'),
    style_query: z.string().optional().describe('文风查询关键词（用于检索相似文风的文献）'),
    reference_ids: z.string().optional().describe('参考的文献ID列表（逗号分隔）'),
    writing_requirements: z.string().optional().describe('写作要求（字数、场景、对象等）'),
    // search_references 参数
    search_query: z.string().optional().describe('搜索查询文本'),
    search_category: z.string().optional().describe('按分类搜索'),
    top_k: z.number().optional().describe('返回结果数量（默认10）'),
  });

  constructor(fields = {}) {
    super();
    this.projectRoot = fields.projectRoot 
      || process.env.PROJECT_ROOT 
      || path.resolve(__dirname, '../../../../');
    
    // 保存 userId（从构造函数参数获取）
    this.userId = fields.userId;
    
    // 初始化 RAG 服务
    if (RAGService) {
      this.ragService = new RAGService();
    } else {
      this.ragService = null;
      logger.warn('[WritingRAGAssistant] RAG服务未初始化，部分功能将不可用');
    }
    
    logger.debug(`[WritingRAGAssistant] projectRoot = ${this.projectRoot}, userId = ${this.userId || '未设置'}`);
  }

  /**
   * 提取文风特征
   * 分析文本的用词、句式、结构等特征
   */
  extractStyleFeatures(text) {
    if (!text || typeof text !== 'string') {
      return null;
    }

    const features = {
      // 用词特征
      vocabulary: {
        formal_words: 0, // 正式词汇数量
        technical_terms: 0, // 专业术语数量
        average_word_length: 0, // 平均词长
      },
      // 句式特征
      sentence: {
        average_length: 0, // 平均句长
        complex_ratio: 0, // 复杂句比例
        question_ratio: 0, // 疑问句比例
      },
      // 结构特征
      structure: {
        paragraph_count: 0, // 段落数
        average_paragraph_length: 0, // 平均段落长度
        has_headings: false, // 是否有标题
      },
      // 风格特征
      style: {
        tone: 'neutral', // 语气：formal/semi-formal/casual/neutral
        density: 'medium', // 信息密度：high/medium/low
      },
    };

    // 简单的中文文本分析
    const sentences = text.split(/[。！？；\n]+/).filter(s => s.trim().length > 0);
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const words = text.match(/[\u4e00-\u9fa5]+/g) || [];

    // 计算平均句长
    if (sentences.length > 0) {
      features.sentence.average_length = Math.round(
        sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
      );
    }

    // 计算平均段落长度
    if (paragraphs.length > 0) {
      features.structure.paragraph_count = paragraphs.length;
      features.structure.average_paragraph_length = Math.round(
        paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphs.length
      );
    }

    // 检测是否有标题（包含"一、二、三"或"第X章"等）
    features.structure.has_headings = /[一二三四五六七八九十]+[、.]|第[一二三四五六七八九十\d]+[章节部分]/.test(text);

    // 检测正式词汇（简单关键词匹配）
    const formalKeywords = ['根据', '依据', '按照', '遵照', '鉴于', '鉴于', '特此', '兹', '予以', '予以'];
    features.vocabulary.formal_words = formalKeywords.reduce((count, keyword) => {
      return count + (text.includes(keyword) ? 1 : 0);
    }, 0);

    // 检测语气（基于关键词）
    if (features.vocabulary.formal_words > 3) {
      features.style.tone = 'formal';
    } else if (features.vocabulary.formal_words > 1) {
      features.style.tone = 'semi-formal';
    }

    // 计算信息密度（基于平均句长和段落长度）
    if (features.sentence.average_length > 50) {
      features.style.density = 'high';
    } else if (features.sentence.average_length < 20) {
      features.style.density = 'low';
    }

    return features;
  }

  /**
   * Handle add_reference command - 添加参考文献
   */
  async handleAddReference(args, userId) {
    const { title, content, file_id, filename, author, category, tags } = args;

    if (!this.ragService) {
      return JSON.stringify({
        success: false,
        error: 'RAG服务未初始化，无法添加参考文献',
      }, null, 2);
    }

    if (!content && !file_id) {
      return JSON.stringify({
        success: false,
        error: '必须提供 content（文献内容）或 file_id（文件ID）',
      }, null, 2);
    }

    try {
      // 如果提供了 file_id，说明文件已经上传并向量化，只需要添加到知识库
      if (file_id) {
        // 文件已经通过上传API向量化，这里只需要创建知识条目关联
        const result = await this.ragService.addKnowledge({
          userId,
          type: KnowledgeType.BUSINESS_KNOWLEDGE,
          data: {
            title: title || filename || '未命名文献',
            content: content || '', // 文件内容可能很大，这里可以为空
            category: category || '参考文献',
            tags: tags ? tags.split(',').map(t => t.trim()) : [],
            fileId: file_id,
            filename: filename,
          },
        });

        return JSON.stringify({
          success: true,
          message: '参考文献已添加到知识库',
          reference_id: result._id || result.id,
          title: result.title,
          metadata: {
            file_id,
            filename,
            author,
            category: category || '参考文献',
            tags: tags ? tags.split(',').map(t => t.trim()) : [],
          },
        }, null, 2);
      }

      // 如果没有 file_id，需要直接存储文本内容
      if (!content) {
        return JSON.stringify({
          success: false,
          error: '必须提供 content（文献内容）',
        }, null, 2);
      }

      // 添加文本内容到知识库（会自动向量化）
      const result = await this.ragService.addKnowledge({
        userId,
        type: KnowledgeType.BUSINESS_KNOWLEDGE,
        data: {
          title: title || '未命名文献',
          content,
          category: category || '参考文献',
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
        },
      });

      return JSON.stringify({
        success: true,
        message: '参考文献已添加到知识库并完成向量化',
        reference_id: result._id || result.id,
        title: result.title,
        content_preview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        metadata: {
          author,
          category: category || '参考文献',
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
        },
      }, null, 2);
    } catch (error) {
      logger.error('[WritingRAGAssistant] 添加参考文献失败:', error);
      return JSON.stringify({
        success: false,
        error: `添加参考文献失败: ${error.message}`,
      }, null, 2);
    }
  }

  /**
   * Handle analyze_style command - 分析文风特征
   */
  async handleAnalyzeStyle(args, userId) {
    const { reference_id, reference_content } = args;

    if (!reference_id && !reference_content) {
      return JSON.stringify({
        success: false,
        error: '必须提供 reference_id（文献ID）或 reference_content（文献内容）',
      }, null, 2);
    }

    try {
      let content = reference_content;

      // 如果提供了 reference_id，从知识库检索内容
      if (reference_id && !content) {
        if (!this.ragService) {
          return JSON.stringify({
            success: false,
            error: 'RAG服务未初始化，无法检索文献',
          }, null, 2);
        }

        // 通过 RAG 查询检索文献
        const searchResults = await this.ragService.query({
          query: `文献ID: ${reference_id}`,
          userId,
          options: {
            topK: 1,
            useReranking: false,
          },
        });

        if (searchResults.results.length === 0) {
          return JSON.stringify({
            success: false,
            error: `未找到ID为 ${reference_id} 的文献`,
          }, null, 2);
        }

        content = searchResults.results[0].content;
      }

      if (!content) {
        return JSON.stringify({
          success: false,
          error: '无法获取文献内容',
        }, null, 2);
      }

      // 提取文风特征
      const styleFeatures = this.extractStyleFeatures(content);

      return JSON.stringify({
        success: true,
        message: '文风分析完成',
        reference_id: reference_id || null,
        content_length: content.length,
        style_features: styleFeatures,
        style_summary: {
          tone: styleFeatures.style.tone,
          density: styleFeatures.style.density,
          sentence_avg_length: styleFeatures.sentence.average_length,
          paragraph_count: styleFeatures.structure.paragraph_count,
          has_structure: styleFeatures.structure.has_headings,
          formality_level: styleFeatures.vocabulary.formal_words > 3 ? 'high' : 
                          styleFeatures.vocabulary.formal_words > 1 ? 'medium' : 'low',
        },
        recommendations: this.generateStyleRecommendations(styleFeatures),
      }, null, 2);
    } catch (error) {
      logger.error('[WritingRAGAssistant] 分析文风失败:', error);
      return JSON.stringify({
        success: false,
        error: `分析文风失败: ${error.message}`,
      }, null, 2);
    }
  }

  /**
   * 生成文风建议
   */
  generateStyleRecommendations(features) {
    const recommendations = [];

    if (features.style.tone === 'formal') {
      recommendations.push('该文献采用正式语气，适合用于正式公文、报告等场景');
    } else if (features.style.tone === 'semi-formal') {
      recommendations.push('该文献采用半正式语气，适合用于一般工作文书');
    }

    if (features.sentence.average_length > 50) {
      recommendations.push('该文献句式较长，信息密度高，适合表达复杂观点');
    } else if (features.sentence.average_length < 20) {
      recommendations.push('该文献句式简短，表达直接，适合快速传达信息');
    }

    if (features.structure.has_headings) {
      recommendations.push('该文献具有清晰的层次结构，适合长篇文档');
    }

    return recommendations;
  }

  /**
   * Handle generate_with_style command - 基于参考文风生成内容
   */
  async handleGenerateWithStyle(args, userId) {
    const { query, style_query, reference_ids, writing_requirements } = args;

    if (!this.ragService) {
      return JSON.stringify({
        success: false,
        error: 'RAG服务未初始化，无法生成内容',
      }, null, 2);
    }

    if (!query) {
      return JSON.stringify({
        success: false,
        error: '必须提供 query（生成内容的主题或需求描述）',
      }, null, 2);
    }

    try {
      let referenceResults = [];

      // 如果指定了 reference_ids，直接检索这些文献
      if (reference_ids) {
        const ids = reference_ids.split(',').map(id => id.trim());
        // 这里需要逐个检索，或者使用批量查询
        // 简化处理：使用第一个ID进行检索
        for (const refId of ids.slice(0, 3)) { // 最多检索3个
          try {
            const result = await this.ragService.query({
              query: `文献ID: ${refId}`,
              userId,
              options: {
                topK: 1,
                useReranking: false,
              },
            });
            if (result.results.length > 0) {
              referenceResults.push(result.results[0]);
            }
          } catch (err) {
            logger.warn(`[WritingRAGAssistant] 检索文献 ${refId} 失败:`, err.message);
          }
        }
      } else if (style_query) {
        // 使用 style_query 搜索相似文风的文献
        referenceResults = await this.ragService.query({
          query: style_query,
          userId,
          options: {
            types: [KnowledgeType.BUSINESS_KNOWLEDGE],
            topK: 5,
            useReranking: true,
          },
        });
        referenceResults = referenceResults.results || [];
      } else {
        // 使用 query 搜索相关文献
        referenceResults = await this.ragService.query({
          query,
          userId,
          options: {
            types: [KnowledgeType.BUSINESS_KNOWLEDGE],
            topK: 5,
            useReranking: true,
          },
        });
        referenceResults = referenceResults.results || [];
      }

      // 分析参考文献的文风
      const styleAnalyses = [];
      for (const ref of referenceResults.slice(0, 3)) { // 分析前3个
        const features = this.extractStyleFeatures(ref.content);
        if (features) {
          styleAnalyses.push({
            reference_title: ref.title,
            style_features: features,
            similarity_score: ref.score || 0,
          });
        }
      }

      // 综合文风特征
      const combinedStyle = this.combineStyleFeatures(styleAnalyses);

      return JSON.stringify({
        success: true,
        message: '已检索相关参考文献并分析文风，LLM应该基于这些信息生成内容',
        query,
        writing_requirements: writing_requirements || '未指定',
        references_found: referenceResults.length,
        style_analyses: styleAnalyses,
        combined_style: combinedStyle,
        reference_examples: referenceResults.slice(0, 3).map(ref => ({
          title: ref.title,
          content_preview: (ref.content || '').substring(0, 300) + ((ref.content || '').length > 300 ? '...' : ''),
          score: ref.score || 0,
        })),
        instructions: [
          '1. 分析参考文献的文风特征（语气、句式、结构等）',
          '2. 根据 combined_style 中的文风特征，调整生成内容的风格',
          '3. 参考 reference_examples 中的示例，保持相似的表达方式',
          '4. 根据 query 和 writing_requirements 生成符合要求的内容',
          '5. 确保生成的内容在文风上与参考文献保持一致',
        ],
      }, null, 2);
    } catch (error) {
      logger.error('[WritingRAGAssistant] 生成内容失败:', error);
      return JSON.stringify({
        success: false,
        error: `生成内容失败: ${error.message}`,
      }, null, 2);
    }
  }

  /**
   * 综合多个文风特征
   */
  combineStyleFeatures(styleAnalyses) {
    if (styleAnalyses.length === 0) {
      return {
        tone: 'neutral',
        density: 'medium',
        average_sentence_length: 30,
        recommendation: '使用中性语气，中等信息密度',
      };
    }

    // 统计语气
    const tones = styleAnalyses.map(a => a.style_features.style.tone);
    const toneCounts = {};
    tones.forEach(t => {
      toneCounts[t] = (toneCounts[t] || 0) + 1;
    });
    const dominantTone = Object.keys(toneCounts).reduce((a, b) => 
      toneCounts[a] > toneCounts[b] ? a : b
    );

    // 计算平均句长
    const avgSentenceLength = Math.round(
      styleAnalyses.reduce((sum, a) => 
        sum + (a.style_features.sentence.average_length || 30), 0
      ) / styleAnalyses.length
    );

    // 统计信息密度
    const densities = styleAnalyses.map(a => a.style_features.style.density);
    const densityCounts = {};
    densities.forEach(d => {
      densityCounts[d] = (densityCounts[d] || 0) + 1;
    });
    const dominantDensity = Object.keys(densityCounts).reduce((a, b) => 
      densityCounts[a] > densityCounts[b] ? a : b
    );

    return {
      tone: dominantTone,
      density: dominantDensity,
      average_sentence_length: avgSentenceLength,
      formality_level: dominantTone === 'formal' ? 'high' : 
                      dominantTone === 'semi-formal' ? 'medium' : 'low',
      recommendation: `建议使用${dominantTone === 'formal' ? '正式' : dominantTone === 'semi-formal' ? '半正式' : '中性'}语气，${dominantDensity === 'high' ? '高' : dominantDensity === 'low' ? '低' : '中等'}信息密度，平均句长约${avgSentenceLength}字`,
    };
  }

  /**
   * Handle search_references command - 搜索参考文献
   */
  async handleSearchReferences(args, userId) {
    const { search_query, search_category, top_k = 10 } = args;

    if (!this.ragService) {
      return JSON.stringify({
        success: false,
        error: 'RAG服务未初始化，无法搜索参考文献',
      }, null, 2);
    }

    if (!search_query) {
      return JSON.stringify({
        success: false,
        error: '必须提供 search_query（搜索查询文本）',
      }, null, 2);
    }

    try {
      const searchResults = await this.ragService.query({
        query: search_query,
        userId,
        options: {
          types: [KnowledgeType.BUSINESS_KNOWLEDGE],
          topK: top_k,
          useReranking: true,
        },
      });

      // 如果指定了分类，进行过滤
      let filteredResults = searchResults.results || [];
      if (search_category) {
        filteredResults = filteredResults.filter(r => 
          r.metadata?.category === search_category
        );
      }

      return JSON.stringify({
        success: true,
        message: `找到 ${filteredResults.length} 条相关参考文献`,
        query: search_query,
        category_filter: search_category || null,
        results: filteredResults.map((ref, index) => ({
          rank: index + 1,
          reference_id: ref.metadata?.file_id || ref.metadata?.id || `ref_${index}`,
          title: ref.title,
          content_preview: (ref.content || '').substring(0, 200) + ((ref.content || '').length > 200 ? '...' : ''),
          score: ref.score || 0,
          category: ref.metadata?.category || '未分类',
          tags: ref.metadata?.tags || [],
          filename: ref.metadata?.filename || null,
        })),
        total: filteredResults.length,
      }, null, 2);
    } catch (error) {
      logger.error('[WritingRAGAssistant] 搜索参考文献失败:', error);
      return JSON.stringify({
        success: false,
        error: `搜索参考文献失败: ${error.message}`,
      }, null, 2);
    }
  }

  /**
   * Handle list_references command - 列出已存储的参考文献
   */
  async handleListReferences(args, userId) {
    if (!this.ragService) {
      return JSON.stringify({
        success: false,
        error: 'RAG服务未初始化，无法列出参考文献',
      }, null, 2);
    }

    try {
      // 使用空查询或通用查询来获取所有业务知识
      const searchResults = await this.ragService.query({
        query: '参考 文献 文档',
        userId,
        options: {
          types: [KnowledgeType.BUSINESS_KNOWLEDGE],
          topK: 50, // 最多返回50条
          useReranking: false,
        },
      });

      const references = (searchResults.results || []).map((ref, index) => ({
        index: index + 1,
        reference_id: ref.metadata?.file_id || ref.metadata?.id || `ref_${index}`,
        title: ref.title,
        category: ref.metadata?.category || '未分类',
        tags: ref.metadata?.tags || [],
        filename: ref.metadata?.filename || null,
        content_length: (ref.content || '').length,
      }));

      // 按分类分组
      const groupedByCategory = {};
      references.forEach(ref => {
        const category = ref.category;
        if (!groupedByCategory[category]) {
          groupedByCategory[category] = [];
        }
        groupedByCategory[category].push(ref);
      });

      return JSON.stringify({
        success: true,
        message: `共找到 ${references.length} 条参考文献`,
        total: references.length,
        references,
        grouped_by_category: groupedByCategory,
        categories: Object.keys(groupedByCategory),
      }, null, 2);
    } catch (error) {
      logger.error('[WritingRAGAssistant] 列出参考文献失败:', error);
      return JSON.stringify({
        success: false,
        error: `列出参考文献失败: ${error.message}`,
      }, null, 2);
    }
  }

  async _call(args) {
    const startTime = Date.now();
    try {
      const { command, ...restArgs } = args;
      
      // 使用构造函数中保存的 userId
      const userId = this.userId || restArgs.userId || restArgs.user_id;
      
      if (!userId) {
        logger.warn('[WritingRAGAssistant] userId 未设置，某些功能可能无法正常工作');
      }

      logger.info('[WritingRAGAssistant工具调用] ========== 开始调用 ==========');
      const inputParams = {
        command,
        restArgs: { ...restArgs, userId: '[已提取]' },
        timestamp: new Date().toISOString(),
      };
      logger.info(`[WritingRAGAssistant工具调用] 输入参数: ${JSON.stringify(inputParams, null, 2)}`);

      let result;
      switch (command) {
        case 'add_reference':
          result = await this.handleAddReference(restArgs, userId);
          break;
        case 'analyze_style':
          result = await this.handleAnalyzeStyle(restArgs, userId);
          break;
        case 'generate_with_style':
          result = await this.handleGenerateWithStyle(restArgs, userId);
          break;
        case 'search_references':
          result = await this.handleSearchReferences(restArgs, userId);
          break;
        case 'list_references':
          result = await this.handleListReferences(restArgs, userId);
          break;
        default:
          result = JSON.stringify({
            success: false,
            error: `未知命令: ${command}`,
          }, null, 2);
      }

      const duration = Date.now() - startTime;
      
      const resultPreview = typeof result === 'string' 
        ? (result.length > 1000 ? result.substring(0, 1000) + '...' : result)
        : JSON.stringify(result).substring(0, 1000);
      const resultInfo = {
        command,
        resultPreview,
        resultLength: typeof result === 'string' ? result.length : JSON.stringify(result).length,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      };
      logger.info(`[WritingRAGAssistant工具调用] 执行结果: ${JSON.stringify(resultInfo, null, 2)}`);
      logger.info('[WritingRAGAssistant工具调用] ========== 调用完成 ==========');

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorInfo = {
        error: err.message,
        stack: err.stack,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      };
      logger.error(`[WritingRAGAssistant工具调用] 执行错误: ${JSON.stringify(errorInfo, null, 2)}`);
      logger.error('WritingRAGAssistant tool error:', err);
      return JSON.stringify({
        success: false,
        error: err.message,
      }, null, 2);
    }
  }
}

module.exports = WritingRAGAssistant;
