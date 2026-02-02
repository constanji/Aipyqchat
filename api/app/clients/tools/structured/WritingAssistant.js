const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('@aipyq/data-schemas');

/**
 * WritingAssistant Tool - 公文写作辅助工具
 * 
 * This tool allows agents to assist with formal writing tasks:
 * - /writing.clarify - Clarify writing requirements (recipient, scenario, word count, audience, references)
 * - /writing.generate - Generate content based on clarified requirements
 * - /writing.templates - List available templates
 * - /writing.refine - Refine and polish existing content
 * - /writing.outline - Generate writing outline
 */
class WritingAssistant extends Tool {
  name = 'writing';
  description =
    '公文写作辅助工具，支持需求澄清、内容生成、格式规范。' +
    'Commands: clarify (澄清写作需求，收集领导类型/场景/字数/受众/参考资料等信息), ' +
    'generate (根据需求生成内容), templates (列出可用模板), ' +
    'refine (根据反馈润色优化内容), outline (生成写作大纲). ' +
    'Use command name and provide arguments as needed.';

  schema = z.object({
    command: z.enum([
      'clarify',
      'generate',
      'templates',
      'refine',
      'outline',
    ]),
    arguments: z.string().optional().describe('Command arguments (e.g., content description for generate command)'),
    // 需求澄清字段
    recipient_type: z.string().optional().describe('收文对象类型：上级领导/同级部门/下级单位/外部单位'),
    recipient_title: z.string().optional().describe('具体职务称谓，如"处长"、"主任"、"总经理"'),
    scenario: z.string().optional().describe('场景类型：report/letter/speech/briefing/proposal/memo'),
    context: z.string().optional().describe('写作背景描述'),
    word_count: z.number().optional().describe('目标字数'),
    audience: z.string().optional().describe('主要阅读对象'),
    purpose: z.string().optional().describe('写作目的'),
    tone: z.string().optional().describe('语气风格：formal/semi-formal/professional'),
    references: z.string().optional().describe('参考资料或依据文件'),
    key_points: z.string().optional().describe('必须包含的要点'),
    content: z.string().optional().describe('待处理的内容（用于refine命令）'),
    feedback: z.string().optional().describe('优化反馈意见（用于refine命令）'),
  });

  constructor(fields = {}) {
    super();
    // 与SocialMedia完全一致的projectRoot获取逻辑
    this.projectRoot = fields.projectRoot 
      || process.env.PROJECT_ROOT 
      || path.resolve(__dirname, '../../../../');
    this.templatesDir = path.join(this.projectRoot, 'specs', 'writing-templates');
    
    logger.debug(`[WritingAssistant] projectRoot = ${this.projectRoot}`);
    logger.debug(`[WritingAssistant] templatesDir = ${this.templatesDir}`);
  }

  /**
   * Find repository root by looking for .git or .specify directory
   */
  async findRepoRoot(startPath = this.projectRoot) {
    let currentPath = path.resolve(startPath);
    const root = path.parse(currentPath).root;

    while (currentPath !== root) {
      const gitPath = path.join(currentPath, '.git');
      const specifyPath = path.join(currentPath, '.specify');
      
      try {
        const [gitExists, specifyExists] = await Promise.all([
          fs.access(gitPath).then(() => true).catch(() => false),
          fs.access(specifyPath).then(() => true).catch(() => false),
        ]);

        if (gitExists || specifyExists) {
          return currentPath;
        }
      } catch (err) {
        // Continue searching
      }

      currentPath = path.dirname(currentPath);
    }

    return this.projectRoot;
  }

  /**
   * Load a template file
   */
  async loadTemplate(templatePath) {
    // 直接使用 projectRoot，不再依赖 findRepoRoot()
    const fullPath = path.join(this.projectRoot, templatePath);

    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch (err) {
      logger.error(`[WritingAssistant] 加载模板失败 - 完整路径: ${fullPath}`);
      logger.error(`[WritingAssistant] projectRoot: ${this.projectRoot}`);
      logger.error(`[WritingAssistant] templatePath: ${templatePath}`);
      logger.error(`[WritingAssistant] 错误: ${err.message}`);
      throw new Error(`无法加载模板: ${templatePath} (完整路径: ${fullPath}, 错误: ${err.message})`);
    }
  }

  /**
   * Load command template
   */
  async loadCommandTemplate(commandName) {
    const templatePath = path.join(this.projectRoot, 'specs', 'writing-templates', 'commands', `${commandName}.md`);

    try {
      return await fs.readFile(templatePath, 'utf-8');
    } catch (err) {
      logger.error(`[WritingAssistant] 加载命令模板失败: ${templatePath}`);
      throw new Error(`命令模板不存在: ${templatePath} (错误: ${err.message})`);
    }
  }

  /**
   * Detect scenario type from user input
   */
  detectScenario(userInput) {
    const input = userInput.toLowerCase();
    
    // 报告类关键词
    const reportKeywords = ['报告', '总结', '汇报', '调研', '分析', '述职', '工作报告', '年度总结', '季度总结', '月度总结'];
    // 函件类关键词
    const letterKeywords = ['请示', '批复', '函', '通知', '通报', '公函', '复函', '商洽函', '邀请函', '催办函'];
    // 讲话类关键词
    const speechKeywords = ['讲话', '发言', '致辞', '演讲', '开幕词', '闭幕词', '欢迎词', '答谢词', '主持词'];
    // 简报类关键词
    const briefingKeywords = ['简报', '情况说明', '工作进展', '进度汇报', '动态'];
    // 方案类关键词
    const proposalKeywords = ['方案', '计划', '建议', '规划', '策划', '实施方案', '工作计划', '建议书'];
    // 纪要类关键词
    const memoKeywords = ['纪要', '备忘', '会议', '记录', '会议纪要', '备忘录'];

    if (reportKeywords.some(keyword => input.includes(keyword))) {
      return 'report';
    }
    if (letterKeywords.some(keyword => input.includes(keyword))) {
      return 'letter';
    }
    if (speechKeywords.some(keyword => input.includes(keyword))) {
      return 'speech';
    }
    if (briefingKeywords.some(keyword => input.includes(keyword))) {
      return 'briefing';
    }
    if (proposalKeywords.some(keyword => input.includes(keyword))) {
      return 'proposal';
    }
    if (memoKeywords.some(keyword => input.includes(keyword))) {
      return 'memo';
    }

    return 'general';
  }

  /**
   * Get template path for scenario
   */
  getTemplatePath(scenario) {
    const templates = {
      report: 'specs/writing-templates/templates/official-documents/report-template.md',
      letter: 'specs/writing-templates/templates/letters/request-letter.md',
      speech: 'specs/writing-templates/templates/speeches/leader-speech.md',
      briefing: 'specs/writing-templates/templates/official-documents/summary-template.md',
      proposal: 'specs/writing-templates/templates/proposals/plan-template.md',
      memo: 'specs/writing-templates/templates/official-documents/memo-template.md',
      general: 'specs/writing-templates/templates/general-template.md',
    };

    return templates[scenario] || templates.general;
  }

  /**
   * Load format guides
   */
  async loadFormatGuides() {
    const guidesDir = path.join(this.projectRoot, 'specs', 'writing-templates', 'guides');

    try {
      const [toneGuide, formatGuide] = await Promise.all([
        fs.readFile(path.join(guidesDir, 'tone-guide.md'), 'utf-8').catch(() => null),
        fs.readFile(path.join(guidesDir, 'format-guide.md'), 'utf-8').catch(() => null),
      ]);

      return {
        toneGuide: toneGuide ? toneGuide.substring(0, 1500) + '...' : null,
        formatGuide: formatGuide ? formatGuide.substring(0, 1500) + '...' : null,
      };
    } catch (err) {
      logger.warn('Failed to load format guides:', err.message);
      return {};
    }
  }

  /**
   * Handle clarify command - 澄清写作需求
   */
  async handleClarify(args) {
    const { arguments: userInput, ...providedFields } = args;

    try {
      // 加载命令模板
      const commandTemplate = await this.loadCommandTemplate('clarify-command').catch(() => null);

      // 构建需求澄清问题清单
      const clarificationQuestions = {
        recipient: {
          question: '这份材料是给谁看的？（收文对象）',
          options: ['上级领导', '同级部门', '下级单位', '外部单位', '公众/社会'],
          current_value: providedFields.recipient_type || null,
          follow_up: '具体的职务或称谓是什么？（如：处长、主任、总经理）',
          follow_up_value: providedFields.recipient_title || null,
        },
        scenario: {
          question: '这是什么类型的写作？',
          options: [
            { value: 'report', label: '工作报告/总结（年度总结、调研报告、述职报告）' },
            { value: 'letter', label: '请示/批复/函件（请示、通知、通报、公函）' },
            { value: 'speech', label: '讲话/致辞（领导讲话、欢迎词、开幕词）' },
            { value: 'briefing', label: '简报/汇报（工作简报、进度汇报）' },
            { value: 'proposal', label: '方案/计划（实施方案、工作计划、建议书）' },
            { value: 'memo', label: '会议纪要/备忘录' },
            { value: 'general', label: '其他类型' },
          ],
          current_value: providedFields.scenario || (userInput ? this.detectScenario(userInput) : null),
        },
        context: {
          question: '请简述写作的背景和目的',
          description: '包括：事件背景、写作缘由、期望达成的目标',
          current_value: providedFields.context || userInput || null,
        },
        word_count: {
          question: '预期字数范围？',
          options: [
            { value: 500, label: '500字以内（简短通知、便函）' },
            { value: 1000, label: '500-1000字（一般公文、短报告）' },
            { value: 2000, label: '1000-2000字（标准报告、方案）' },
            { value: 3000, label: '2000-3000字（详细报告、规划）' },
            { value: 5000, label: '3000字以上（综合性报告、调研报告）' },
          ],
          current_value: providedFields.word_count || null,
        },
        audience: {
          question: '主要阅读对象是谁？',
          description: '除收文对象外，还有哪些人会阅读此材料？',
          current_value: providedFields.audience || null,
        },
        purpose: {
          question: '写作的主要目的是什么？',
          options: ['汇报工作', '请求批准', '通知告知', '征求意见', '总结经验', '部署任务', '表彰表扬', '其他'],
          current_value: providedFields.purpose || null,
        },
        tone: {
          question: '语气风格偏好？',
          options: [
            { value: 'formal', label: '正式严谨（用于重要公文、上级报告）' },
            { value: 'semi-formal', label: '平实稳重（用于一般工作文书）' },
            { value: 'professional', label: '专业务实（用于业务文书、技术报告）' },
            { value: 'warm', label: '热情亲切（用于致辞、感谢信）' },
          ],
          current_value: providedFields.tone || null,
        },
        key_points: {
          question: '有哪些必须包含的要点？',
          description: '列出必须在文中体现的关键信息、数据或观点',
          current_value: providedFields.key_points || null,
        },
        references: {
          question: '有无参考资料或依据文件？',
          description: '如：上级文件、会议精神、政策法规、历史数据等',
          current_value: providedFields.references || null,
        },
      };

      // 计算已填写的字段
      const filledFields = Object.entries(clarificationQuestions)
        .filter(([_, q]) => q.current_value !== null)
        .map(([key, _]) => key);
      
      const missingFields = Object.entries(clarificationQuestions)
        .filter(([_, q]) => q.current_value === null)
        .map(([key, _]) => key);

      // 获取当前日期时间
      const now = new Date();
      const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

      return JSON.stringify({
        success: true,
        message: '需求澄清命令已识别。请根据以下问题完善写作需求信息。',
        user_input: userInput || null,
        detected_scenario: userInput ? this.detectScenario(userInput) : null,
        clarification_questions: clarificationQuestions,
        progress: {
          filled_fields: filledFields,
          missing_fields: missingFields,
          completion_percentage: Math.round((filledFields.length / Object.keys(clarificationQuestions).length) * 100),
        },
        dynamic_variables: {
          date: dateStr,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
        instructions: [
          '1. 逐项回答上述问题，收集完整的写作需求信息',
          '2. 对于已填写的字段（current_value不为null），可以跳过或确认',
          '3. 收集完成后，可使用 /writing.outline 生成大纲',
          '4. 确认大纲后，使用 /writing.generate 生成内容',
        ],
        command_template: commandTemplate ? commandTemplate.substring(0, 2000) + '...' : null,
      }, null, 2);
    } catch (err) {
      logger.error('WritingAssistant clarify error:', err);
      return JSON.stringify({
        success: false,
        error: `澄清写作需求时出错: ${err.message}`,
      }, null, 2);
    }
  }

  /**
   * Handle generate command - 生成内容
   */
  async handleGenerate(args) {
    const { arguments: userInput, scenario: providedScenario, ...otherFields } = args;

    if (!userInput || !userInput.trim()) {
      return JSON.stringify({
        success: false,
        error: '用户输入是必需的。请提供写作需求描述，或先使用 /writing.clarify 澄清需求。',
      }, null, 2);
    }

    try {
      // 检测或使用提供的场景
      const scenario = providedScenario || this.detectScenario(userInput);
      const templatePath = this.getTemplatePath(scenario);

      // 加载模板和指南
      const [template, commandTemplate, formatGuides] = await Promise.all([
        this.loadTemplate(templatePath).catch(() => null),
        this.loadCommandTemplate('generate-command').catch(() => null),
        this.loadFormatGuides(),
      ]);

      if (!template) {
        return JSON.stringify({
          success: false,
          error: `无法加载模板: ${templatePath}`,
        }, null, 2);
      }

      // 获取当前日期时间
      const now = new Date();
      const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

      // 构建写作上下文
      const writingContext = {
        recipient_type: otherFields.recipient_type || '未指定',
        recipient_title: otherFields.recipient_title || '未指定',
        context: otherFields.context || userInput,
        word_count: otherFields.word_count || 1000,
        audience: otherFields.audience || '相关领导和同事',
        purpose: otherFields.purpose || '未指定',
        tone: otherFields.tone || 'formal',
        key_points: otherFields.key_points || '未指定',
        references: otherFields.references || '无',
      };

      return JSON.stringify({
        success: true,
        message: '内容生成命令已识别。LLM 应该根据需求和模板生成内容。',
        user_input: userInput,
        detected_scenario: scenario,
        template_path: templatePath,
        writing_context: writingContext,
        dynamic_variables: {
          date: dateStr,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
        note: 'LLM 应该：1. 读取场景模板了解内容结构 2. 从用户输入和writing_context提取信息 3. 替换所有占位符 4. 应用格式规范 5. 生成最终内容',
        templates: {
          command_template: commandTemplate ? commandTemplate.substring(0, 2000) + '...' : null,
          scenario_template: template.substring(0, 2000) + '...',
          format_guides: formatGuides,
        },
        instructions: [
          '1. 分析用户输入和writing_context，提取关键信息',
          '2. 根据场景模板的结构，组织内容',
          '3. 替换所有占位符（使用动态变量和提取的信息）',
          '4. 应用语气风格（' + writingContext.tone + '）',
          '5. 控制字数在目标范围（约' + writingContext.word_count + '字）',
          '6. 生成完整的公文内容',
        ],
      }, null, 2);
    } catch (err) {
      logger.error('WritingAssistant generate error:', err);
      return JSON.stringify({
        success: false,
        error: `生成内容时出错: ${err.message}`,
      }, null, 2);
    }
  }

  /**
   * Handle templates command - 列出可用模板
   */
  async handleTemplates(args) {
    try {
      const templates = {
        report: {
          name: '工作报告/总结',
          path: 'templates/official-documents/report-template.md',
          description: '适用于年度总结、调研报告、述职报告、工作汇报',
          examples: ['年度工作总结', '调研分析报告', '项目进展报告'],
        },
        letter: {
          name: '请示/函件',
          path: 'templates/letters/request-letter.md',
          description: '适用于请示、批复、通知、通报、公函',
          examples: ['请示报告', '工作通知', '情况通报'],
        },
        speech: {
          name: '讲话/致辞',
          path: 'templates/speeches/leader-speech.md',
          description: '适用于领导讲话、开幕词、闭幕词、欢迎词',
          examples: ['会议讲话', '开幕致辞', '欢迎词'],
        },
        briefing: {
          name: '简报/汇报',
          path: 'templates/official-documents/summary-template.md',
          description: '适用于工作简报、进度汇报、情况说明',
          examples: ['工作简报', '进度汇报', '情况说明'],
        },
        proposal: {
          name: '方案/计划',
          path: 'templates/proposals/plan-template.md',
          description: '适用于实施方案、工作计划、建议书、规划',
          examples: ['实施方案', '年度计划', '工作建议'],
        },
        memo: {
          name: '会议纪要',
          path: 'templates/official-documents/memo-template.md',
          description: '适用于会议纪要、备忘录',
          examples: ['会议纪要', '工作备忘录'],
        },
        general: {
          name: '通用模板',
          path: 'templates/general-template.md',
          description: '适用于其他类型的正式文书',
          examples: ['申请书', '说明书', '其他公文'],
        },
      };

      return JSON.stringify({
        success: true,
        message: '可用模板列表',
        templates,
        guides: [
          'tone-guide.md - 语气风格指南',
          'format-guide.md - 格式规范指南',
        ],
        usage: [
          '使用 /writing.clarify 命令澄清写作需求',
          '使用 /writing.generate 命令并指定 scenario 参数来选择特定模板',
          '或让系统根据用户输入自动检测场景类型',
        ],
      }, null, 2);
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: `获取模板列表时出错: ${err.message}`,
      }, null, 2);
    }
  }

  /**
   * Handle refine command - 润色优化内容
   */
  async handleRefine(args) {
    const { content, feedback, arguments: contentFromArgs } = args;

    const targetContent = content || contentFromArgs;

    if (!targetContent || !targetContent.trim()) {
      return JSON.stringify({
        success: false,
        error: '需要润色的内容是必需的。请提供 content 参数。',
      }, null, 2);
    }

    try {
      const formatGuides = await this.loadFormatGuides();

      return JSON.stringify({
        success: true,
        message: '内容润色命令已识别。LLM 应该根据反馈和格式规范优化内容。',
        original_content: targetContent.substring(0, 1000) + (targetContent.length > 1000 ? '...' : ''),
        content_length: targetContent.length,
        feedback: feedback || '请进行通用润色优化',
        format_guides: formatGuides,
        instructions: [
          '1. 检查文本格式（段落结构、标点符号、用词规范）',
          '2. 检查语气风格是否一致',
          '3. 检查逻辑结构是否清晰',
          '4. 根据反馈意见进行针对性修改',
          '5. 应用公文写作规范',
          '6. 返回润色后的完整内容',
        ],
        refinement_aspects: [
          '用词规范：避免口语化表达，使用规范公文用语',
          '结构优化：确保层次分明、逻辑清晰',
          '语气调整：保持正式、专业的语气',
          '格式规范：检查标题、段落、标点等格式',
          '内容精炼：删除冗余表述，突出重点',
        ],
      }, null, 2);
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: `润色内容时出错: ${err.message}`,
      }, null, 2);
    }
  }

  /**
   * Handle outline command - 生成写作大纲
   */
  async handleOutline(args) {
    const { arguments: userInput, scenario: providedScenario, ...otherFields } = args;

    if (!userInput || !userInput.trim()) {
      return JSON.stringify({
        success: false,
        error: '用户输入是必需的。请提供写作需求描述。',
      }, null, 2);
    }

    try {
      const scenario = providedScenario || this.detectScenario(userInput);
      const templatePath = this.getTemplatePath(scenario);

      const template = await this.loadTemplate(templatePath).catch(() => null);

      // 根据场景提供大纲结构建议
      const outlineStructures = {
        report: {
          name: '工作报告大纲',
          structure: [
            '一、工作概述（背景、目标、时间范围）',
            '二、主要工作及成效',
            '    （一）重点工作一',
            '    （二）重点工作二',
            '    （三）重点工作三',
            '三、存在问题及分析',
            '四、下一步工作计划',
            '五、结语',
          ],
        },
        letter: {
          name: '请示/函件大纲',
          structure: [
            '标题：关于XXX的请示/函',
            '主送机关：XXX',
            '一、请示/来函缘由（背景说明）',
            '二、请示/商洽事项',
            '三、请求/建议',
            '结语：妥否，请批示/请予以支持',
            '落款：单位名称、日期',
          ],
        },
        speech: {
          name: '讲话稿大纲',
          structure: [
            '开场（称呼、问候）',
            '一、引言（会议/活动背景）',
            '二、主体内容',
            '    （一）回顾与总结',
            '    （二）当前形势分析',
            '    （三）工作部署/要求',
            '三、结语（期望、祝愿）',
          ],
        },
        proposal: {
          name: '方案/计划大纲',
          structure: [
            '一、背景与目的',
            '二、总体要求/目标',
            '三、主要内容/措施',
            '    （一）措施一',
            '    （二）措施二',
            '    （三）措施三',
            '四、实施步骤/时间安排',
            '五、保障措施',
            '六、预期效果',
          ],
        },
        memo: {
          name: '会议纪要大纲',
          structure: [
            '会议基本信息（时间、地点、主持人、参会人员）',
            '一、会议议题',
            '二、讨论情况',
            '三、会议决定事项',
            '    （一）决定事项一',
            '    （二）决定事项二',
            '四、工作分工及时限要求',
          ],
        },
        general: {
          name: '通用大纲',
          structure: [
            '一、引言/背景',
            '二、主体内容',
            '三、结论/建议',
            '四、落款',
          ],
        },
      };

      const outlineGuide = outlineStructures[scenario] || outlineStructures.general;

      return JSON.stringify({
        success: true,
        message: '大纲生成命令已识别。LLM 应该根据需求生成详细的写作大纲。',
        user_input: userInput,
        detected_scenario: scenario,
        writing_context: {
          recipient_type: otherFields.recipient_type || '未指定',
          word_count: otherFields.word_count || 1000,
          purpose: otherFields.purpose || '未指定',
          key_points: otherFields.key_points || '未指定',
        },
        outline_guide: outlineGuide,
        template_preview: template ? template.substring(0, 1000) + '...' : null,
        instructions: [
          '1. 根据场景类型选择合适的大纲结构',
          '2. 结合用户输入的具体内容填充大纲',
          '3. 在每个大纲项下标注要点和预估字数',
          '4. 确保大纲逻辑清晰、层次分明',
          '5. 生成可直接用于写作的详细大纲',
        ],
        next_step: '确认大纲后，使用 /writing.generate 生成完整内容',
      }, null, 2);
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: `生成大纲时出错: ${err.message}`,
      }, null, 2);
    }
  }

  async _call(args) {
    const startTime = Date.now();
    try {
      const { command, ...restArgs } = args;
      const fullArgs = { ...restArgs };

      logger.info('[WritingAssistant工具调用] ========== 开始调用 ==========');
      const inputParams = {
        command,
        fullArgs,
        timestamp: new Date().toISOString(),
      };
      logger.info(`[WritingAssistant工具调用] 输入参数: ${JSON.stringify(inputParams, null, 2)}`);

      let result;
      switch (command) {
        case 'clarify':
          result = await this.handleClarify(fullArgs);
          break;
        case 'generate':
          result = await this.handleGenerate(fullArgs);
          break;
        case 'templates':
          result = await this.handleTemplates(fullArgs);
          break;
        case 'refine':
          result = await this.handleRefine(fullArgs);
          break;
        case 'outline':
          result = await this.handleOutline(fullArgs);
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
      logger.info(`[WritingAssistant工具调用] 执行结果: ${JSON.stringify(resultInfo, null, 2)}`);
      logger.info('[WritingAssistant工具调用] ========== 调用完成 ==========');

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorInfo = {
        error: err.message,
        stack: err.stack,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      };
      logger.error(`[WritingAssistant工具调用] 执行错误: ${JSON.stringify(errorInfo, null, 2)}`);
      logger.error('WritingAssistant tool error:', err);
      return JSON.stringify({
        success: false,
        error: err.message,
      }, null, 2);
    }
  }
}

module.exports = WritingAssistant;
