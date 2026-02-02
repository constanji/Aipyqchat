const { logger } = require('@aipyq/data-schemas');
const mongoose = require('mongoose');
const { createModels } = require('@aipyq/data-schemas');

/**
 * 语义角色定义
 * 每个语义模型必须声明其语义角色，而不是通过表名猜测
 */
const SemanticRole = {
  ENTITY: 'entity',      // 实体：人、物、概念（如客户、商品、医生）
  FACT: 'fact',          // 事实表：交易、订单、支付（可聚合的业务事实）
  SNAPSHOT: 'snapshot',  // 快照：库存、状态、余额（时间点的状态）
  EVENT: 'event',        // 事件：行为、日志、变更（不可聚合的事件流）
};

/**
 * 语义描述符基类
 * 定义生成语义模型说明的接口
 */
class SemanticDescriptor {
  /**
   * 生成模型描述
   * @param {Object} model - 语义模型对象
   * @param {Object} context - 上下文信息（主键、维度、度量等）
   * @returns {string} 生成的描述文本
   */
  generateDescription(model, context) {
    throw new Error('generateDescription must be implemented by subclass');
  }

  /**
   * 生成业务问题示例
   * @param {Object} model - 语义模型对象
   * @param {Object} context - 上下文信息
   * @returns {Array<string>} 业务问题列表
   */
  generateBusinessQuestions(model, context) {
    return [];
  }

  /**
   * 生成关键点
   * @param {Object} model - 语义模型对象
   * @param {Object} context - 上下文信息
   * @returns {Array<string>} 关键点列表
   */
  generateKeyPoints(model, context) {
    return [];
  }
}

/**
 * 实体描述符
 * 用于描述"人"、"物"、"概念"等实体
 */
class EntityDescriptor extends SemanticDescriptor {
  generateDescription(model, context) {
    const { primaryKey, dimensions, measures, identifiableFields } = context;
    const modelName = model.name || model.model || '实体';
    const tableName = model.model || model.table || modelName;
    
    let desc = `\`${tableName}\` 表是一个**实体表**，用于存储业务中的核心实体对象。\n\n`;
    
    // 根据字段推断实体类型
    const hasNameField = identifiableFields.some(f => f.includes('name') || f.includes('title'));
    const hasContactField = identifiableFields.some(f => f.includes('phone') || f.includes('email'));
    
    if (hasNameField && hasContactField) {
      desc += '该表通常存储**客户、用户或联系人**等人员信息，包含姓名、联系方式等基本属性。';
    } else if (hasNameField) {
      desc += '该表存储实体的基本信息，包含名称、标识等属性。';
    } else {
      desc += `该表存储"${modelName}"相关的实体信息。`;
    }
    
    if (primaryKey) {
      desc += `每个实体通过 \`${primaryKey}\` 字段唯一标识。`;
    }
    
    if (dimensions.length > 0) {
      desc += `\n\n可以通过 ${dimensions.slice(0, 2).join('、')} 等维度字段进行分组和筛选。`;
    }
    
    return desc;
  }

  generateBusinessQuestions(model, context) {
    const { dimensions, measures, identifiableFields } = context;
    const questions = [];
    const modelName = model.name || model.model || '实体';
    
    // 基于字段生成问题
    if (identifiableFields.some(f => f.includes('name'))) {
      questions.push(`查询${modelName}的基本信息`);
      questions.push(`按名称搜索${modelName}`);
    }
    
    if (dimensions.length > 0) {
      questions.push(`按${dimensions[0]}统计${modelName}的数量分布`);
    }
    
    if (measures.length > 0) {
      questions.push(`统计${modelName}的${measures[0]}情况`);
    } else {
      questions.push(`统计${modelName}的总数`);
    }
    
    return questions.length > 0 ? questions : [`查询${modelName}信息`];
  }

  generateKeyPoints(model, context) {
    const { primaryKey, dimensions, identifiableFields } = context;
    const points = [];
    
    if (primaryKey) {
      points.push(`\`${primaryKey}\` 是主键，唯一标识每条记录`);
    }
    
    if (identifiableFields.length > 0) {
      points.push(`可通过 ${identifiableFields.slice(0, 2).join('、')} 等字段直接识别实体`);
    }
    
    if (dimensions.length > 0) {
      points.push(`支持按 ${dimensions.slice(0, 2).join('、')} 等维度进行分组分析`);
    }
    
    return points;
  }
}

/**
 * 事实表描述符
 * 用于描述交易、订单等可聚合的业务事实
 */
class FactDescriptor extends SemanticDescriptor {
  generateDescription(model, context) {
    const { measures, dimensions, primaryKey } = context;
    const modelName = model.name || model.model || '事实表';
    const tableName = model.model || model.table || modelName;
    
    let desc = `\`${tableName}\` 表是一个**事实表**，记录业务中发生的交易、订单等可聚合的业务事实。\n\n`;
    
    const hasAmount = measures.some(m => m.includes('amount') || m.includes('total') || m.includes('price'));
    const hasQuantity = measures.some(m => m.includes('quantity') || m.includes('count') || m.includes('num'));
    
    if (hasAmount && hasQuantity) {
      desc += '该表包含**金额、数量**等可汇总的度量值，是业务分析的核心数据源。';
      desc += '可用于计算GMV（总交易额）、销量、订单数等关键业务指标。';
    } else if (hasAmount) {
      desc += '该表包含**金额**等可汇总的度量值，用于财务和交易分析。';
    } else if (hasQuantity) {
      desc += '该表包含**数量**等可汇总的度量值，用于统计和分析。';
    } else {
      desc += `该表记录"${modelName}"相关的业务事实。`;
    }
    
    if (primaryKey) {
      desc += `\n\n每条记录通过 \`${primaryKey}\` 唯一标识。`;
    }
    
    if (dimensions.length > 0) {
      desc += `可以通过 ${dimensions.slice(0, 2).join('、')} 等维度字段进行分组聚合分析。`;
    }
    
    return desc;
  }

  generateBusinessQuestions(model, context) {
    const { measures, dimensions } = context;
    const questions = [];
    const modelName = model.name || model.model || '事实表';
    
    const hasAmount = measures.some(m => m.includes('amount') || m.includes('total') || m.includes('price'));
    const hasQuantity = measures.some(m => m.includes('quantity') || m.includes('count'));
    
    if (hasAmount) {
      questions.push(`统计${modelName}的总金额`);
      questions.push(`按时间维度分析${modelName}的金额趋势`);
    }
    
    if (hasQuantity) {
      questions.push(`统计${modelName}的总数量`);
      questions.push(`按维度分析${modelName}的数量分布`);
    }
    
    if (dimensions.length > 0) {
      questions.push(`按${dimensions[0]}维度统计${modelName}的汇总数据`);
    }
    
    return questions.length > 0 ? questions : [`查询${modelName}的统计信息`];
  }

  generateKeyPoints(model, context) {
    const { primaryKey, measures, dimensions } = context;
    const points = [];
    
    if (primaryKey) {
      points.push(`\`${primaryKey}\` 是主键，唯一标识每条交易/事实记录`);
    }
    
    if (measures.length > 0) {
      points.push(`\`${measures.slice(0, 2).join('`、`')}\` 等字段是可聚合的度量值，支持 SUM、AVG、COUNT 等聚合函数`);
    }
    
    if (dimensions.length > 0) {
      points.push(`支持按 \`${dimensions.slice(0, 2).join('`、`')}\` 等维度字段进行 GROUP BY 分组分析`);
    }
    
    // 检查是否有既是维度又是度量的字段
    const dualFields = dimensions.filter(d => measures.includes(d));
    if (dualFields.length > 0) {
      points.push(`\`${dualFields[0]}\` 既可以作为维度（分组），也可以作为度量（聚合）`);
    }
    
    return points;
  }
}

/**
 * 快照描述符
 * 用于描述库存、状态等时间点快照
 */
class SnapshotDescriptor extends SemanticDescriptor {
  generateDescription(model, context) {
    const { dimensions, measures, primaryKey } = context;
    const modelName = model.name || model.model || '快照表';
    const tableName = model.model || model.table || modelName;
    
    let desc = `\`${tableName}\` 表是一个**快照表**，记录某个时间点的状态信息，而非交易事件。\n\n`;
    
    const hasStock = measures.some(m => m.includes('quantity') || m.includes('stock') || m.includes('inventory'));
    const hasBalance = measures.some(m => m.includes('balance') || m.includes('amount'));
    const hasStatus = dimensions.some(d => d.includes('status') || d.includes('state'));
    
    if (hasStock) {
      desc += '该表通常用于记录**库存、余额**等状态信息。';
      desc += '与事实表不同，快照表记录的是"当前状态"而非"发生的事件"。';
    } else if (hasBalance) {
      desc += '该表记录**余额、账户**等状态信息。';
    } else if (hasStatus) {
      desc += '该表记录实体的**状态信息**。';
    } else {
      desc += `该表记录"${modelName}"相关的状态快照。`;
    }
    
    if (primaryKey) {
      desc += `\n\n每条记录通过 \`${primaryKey}\` 唯一标识。`;
    }
    
    if (dimensions.some(d => d.includes('time') || d.includes('date'))) {
      desc += '可以通过时间维度分析状态的变化趋势。';
    }
    
    return desc;
  }

  generateBusinessQuestions(model, context) {
    const { measures, dimensions } = context;
    const questions = [];
    const modelName = model.name || model.model || '快照表';
    
    const hasStock = measures.some(m => m.includes('quantity') || m.includes('stock') || m.includes('inventory'));
    const hasBalance = measures.some(m => m.includes('balance'));
    
    if (hasStock) {
      questions.push(`查询${modelName}中库存不足的记录`);
      questions.push(`统计${modelName}的库存总量`);
      questions.push(`分析${modelName}的库存变化趋势`);
    } else if (hasBalance) {
      questions.push(`查询${modelName}的余额情况`);
      questions.push(`统计${modelName}的余额分布`);
    } else {
      questions.push(`查询${modelName}的当前状态分布`);
      questions.push(`分析${modelName}的状态变化趋势`);
    }
    
    if (dimensions.some(d => d.includes('time') || d.includes('date'))) {
      questions.push(`按时间维度分析${modelName}的状态变化`);
    }
    
    return questions;
  }

  generateKeyPoints(model, context) {
    const { primaryKey, measures, dimensions } = context;
    const points = [];
    
    if (primaryKey) {
      points.push(`\`${primaryKey}\` 是主键，唯一标识每条快照记录`);
    }
    
    // 快照表的特点：状态字段可能既是维度又是度量
    const stateFields = measures.filter(m => 
      m.includes('quantity') || m.includes('stock') || m.includes('balance') || m.includes('inventory')
    );
    if (stateFields.length > 0) {
      points.push(`\`${stateFields[0]}\` 等状态字段既可以作为维度（筛选），也可以作为度量（汇总统计）`);
    }
    
    if (dimensions.some(d => d.includes('time') || d.includes('date'))) {
      points.push('支持按时间维度分析状态的变化趋势');
    }
    
    points.push('快照表与事实表的区别：快照记录"当前状态"，事实表记录"发生的事件"');
    
    return points;
  }
}

/**
 * 事件描述符
 * 用于描述行为、日志等不可聚合的事件流
 */
class EventDescriptor extends SemanticDescriptor {
  generateDescription(model, context) {
    const { dimensions, primaryKey } = context;
    const modelName = model.name || model.model || '事件表';
    const tableName = model.model || model.table || modelName;
    
    let desc = `\`${tableName}\` 表是一个**事件表**，记录业务中发生的行为、操作、日志等事件流。\n\n`;
    
    const hasEventType = dimensions.some(d => d.includes('type') || d.includes('action') || d.includes('event'));
    const hasTime = dimensions.some(d => d.includes('time') || d.includes('date'));
    
    if (hasEventType && hasTime) {
      desc += '该表记录了**事件类型、发生时间、相关对象**等关键信息。';
      desc += '是分析用户行为路径、转化漏斗、推荐系统等场景的核心数据源。';
    } else if (hasEventType) {
      desc += '该表记录不同类型的事件信息，用于行为分析和统计。';
    } else {
      desc += `该表记录"${modelName}"相关的业务事件。`;
    }
    
    if (primaryKey) {
      desc += `\n\n每条事件通过 \`${primaryKey}\` 唯一标识。`;
    }
    
    desc += '与事实表不同，事件表通常记录的是不可聚合的离散事件。';
    
    return desc;
  }

  generateBusinessQuestions(model, context) {
    const { dimensions } = context;
    const questions = [];
    const modelName = model.name || model.model || '事件表';
    
    const hasEventType = dimensions.some(d => d.includes('type') || d.includes('action'));
    const hasTime = dimensions.some(d => d.includes('time') || d.includes('date'));
    
    if (hasEventType) {
      questions.push(`统计${modelName}中不同事件类型的分布`);
      questions.push(`分析${modelName}的事件发生趋势`);
    }
    
    if (hasTime) {
      questions.push(`按时间维度分析${modelName}的事件发生情况`);
    }
    
    questions.push(`查询${modelName}中的特定事件记录`);
    questions.push(`分析${modelName}的事件转化路径`);
    
    return questions;
  }

  generateKeyPoints(model, context) {
    const { primaryKey, dimensions } = context;
    const points = [];
    
    if (primaryKey) {
      points.push(`\`${primaryKey}\` 是主键，唯一标识每条事件记录`);
    }
    
    const eventTypeField = dimensions.find(d => d.includes('type') || d.includes('action'));
    const timeField = dimensions.find(d => d.includes('time') || d.includes('date'));
    
    if (eventTypeField) {
      points.push(`\`${eventTypeField}\` 字段标识事件类型，可用于事件分类和统计`);
    }
    
    if (timeField) {
      points.push(`\`${timeField}\` 字段记录事件发生时间，支持时间序列分析`);
    }
    
    points.push('事件表通常用于分析用户行为路径、转化漏斗、推荐系统等场景');
    points.push('与事实表的区别：事件表记录离散事件，通常不进行金额/数量的聚合计算');
    
    return points;
  }
}

/**
 * 语义角色注册表
 * 将语义角色映射到对应的描述符
 */
const SemanticRoleRegistry = {
  [SemanticRole.ENTITY]: EntityDescriptor,
  [SemanticRole.FACT]: FactDescriptor,
  [SemanticRole.SNAPSHOT]: SnapshotDescriptor,
  [SemanticRole.EVENT]: EventDescriptor,
};

/**
 * 从语义模型结构中提取上下文信息
 * @param {Object} model - 语义模型对象
 * @returns {Object} 上下文信息
 */
function extractModelContext(model) {
  const entities = model.entities || [];
  const dimensions = model.dimensions || [];
  const measures = model.measures || [];
  const columns = model.columns || [];

  // 提取主键
  const primaryEntity = entities.find(e => e.type === 'primary');
  let primaryKey = primaryEntity 
    ? (primaryEntity.expr || primaryEntity.name)
    : null;

  // 提取外键
  const foreignEntities = entities.filter(e => e.type === 'foreign');
  const foreignKeys = foreignEntities.map(e => e.expr || e.name);

  // 从语义模型结构提取维度
  let allDimensions = dimensions.map(d => d.expr || d.name || d.alias).filter(Boolean);
  
  // 从语义模型结构提取度量
  let allMeasures = measures.map(m => m.expr || m.name || m.alias).filter(Boolean);

  // 如果没有语义模型结构，从 columns 分析
  if (columns && columns.length > 0) {
    if (allDimensions.length === 0) {
      allDimensions = columns.filter(col => {
        const type = (col.type || '').toLowerCase();
        const name = (col.name || '').toLowerCase();
        return type.includes('date') || type.includes('time') || type.includes('enum') || 
               type.includes('varchar') || type.includes('char') || 
               name.includes('type') || name.includes('status') || name.includes('category');
      }).map(col => col.name);
    }

    if (allMeasures.length === 0) {
      allMeasures = columns.filter(col => {
        const type = (col.type || '').toLowerCase();
        const name = (col.name || '').toLowerCase();
        return type.includes('int') || type.includes('decimal') || type.includes('float') || 
               type.includes('double') || type.includes('numeric') ||
               name.includes('amount') || name.includes('price') || name.includes('quantity') || 
               name.includes('count') || name.includes('total') || name.includes('sum');
      }).map(col => col.name);
    }

    if (!primaryKey) {
      const primaryKeys = columns.filter(col => {
        const key = (col.key || '').toUpperCase();
        return key === 'PRI' || key === 'PRIMARY' || key.includes('PRIMARY');
      }).map(col => col.name);
      if (primaryKeys.length > 0) {
        primaryKey = primaryKeys[0];
      }
    }
  }

  // 提取可识别字段
  const identifiableFields = columns ? columns.filter(col => {
    const name = (col.name || '').toLowerCase();
    return name.includes('name') || name.includes('title') || name.includes('phone') || 
           name.includes('email') || name.includes('mobile') || name.includes('tel') ||
           name.includes('code') || name.includes('no') || name.includes('number');
  }).map(col => col.name) : [];

  return {
    primaryKey,
    foreignKeys,
    dimensions: allDimensions,
    measures: allMeasures,
    identifiableFields,
  };
}

/**
 * 推断语义角色（如果模型未显式声明）
 * 这是兜底逻辑，优先使用模型声明的 semantic_role
 * @param {Object} model - 语义模型对象
 * @param {Object} context - 上下文信息
 * @returns {string} 推断的语义角色
 */
function inferSemanticRole(model, context) {
  // 优先使用模型显式声明的角色
  if (model.semantic_role && SemanticRoleRegistry[model.semantic_role]) {
    return model.semantic_role;
  }

  const { measures, dimensions } = context;
  const modelName = (model.name || model.model || '').toLowerCase();

  // 基于模型特征推断角色
  // 如果有明确的度量字段，通常是事实表
  if (measures.length > 0 && measures.some(m => 
    m.includes('amount') || m.includes('price') || m.includes('quantity') || m.includes('total')
  )) {
    // 如果包含时间维度且度量是状态类，可能是快照
    if (measures.some(m => m.includes('stock') || m.includes('balance') || m.includes('quantity')) &&
        dimensions.some(d => d.includes('time') || d.includes('date'))) {
      return SemanticRole.SNAPSHOT;
    }
    return SemanticRole.FACT;
  }

  // 如果有事件类型字段，通常是事件表
  if (dimensions.some(d => d.includes('type') || d.includes('action') || d.includes('event')) ||
      modelName.includes('behavior') || modelName.includes('log') || modelName.includes('event')) {
    return SemanticRole.EVENT;
  }

  // 如果有状态字段且没有明显的度量，可能是快照
  if (dimensions.some(d => d.includes('status') || d.includes('state')) ||
      modelName.includes('inventory') || modelName.includes('stock') || modelName.includes('snapshot')) {
    return SemanticRole.SNAPSHOT;
  }

  // 默认作为实体
  return SemanticRole.ENTITY;
}

/**
 * 生成语义模型说明文本
 * 基于语义角色注册表 + 策略模式，生成结构化的语义模型说明
 * @param {Object} params
 * @param {string} params.databaseName - 数据库名称
 * @param {Array} params.semanticModels - 语义模型数组
 * @returns {string} 生成的说明文本
 */
function generateSemanticModelDescription({ databaseName, semanticModels }) {
  if (!semanticModels || semanticModels.length === 0) {
    return '';
  }

  let description = '';
  
  // 添加数据库级别的说明
  if (databaseName) {
    description += `# 数据库：${databaseName}\n\n`;
    description += `本数据库包含 ${semanticModels.length} 个语义模型，用于业务数据分析和查询。\n\n`;
    description += '---\n\n';
  }

  // 生成每个表的说明
  semanticModels.forEach((model, index) => {
    const modelNumber = index + 1;
    const modelName = model.name || model.model || '未知表';
    const tableName = model.model || model.table || modelName;
    
    // 提取模型上下文
    const context = extractModelContext(model);
    
    // 确定语义角色（优先使用声明，否则推断）
    const semanticRole = inferSemanticRole(model, context);
    
    // 从注册表获取对应的描述符
    const DescriptorClass = SemanticRoleRegistry[semanticRole];
    if (!DescriptorClass) {
      // 如果角色不存在，使用默认实体描述符
      const descriptor = new EntityDescriptor();
      const modelDesc = model.description || descriptor.generateDescription(model, context);
      description += `## ${modelNumber}. ${modelName}\n\n`;
      description += `**表名**: \`${tableName}\`\n\n`;
      description += `**语义角色**: 实体 (entity)\n\n`;
      description += `**说明**:\n\n${modelDesc}\n\n`;
      description += '---\n\n';
      return;
    }
    
    // 实例化描述符并生成内容
    const descriptor = new DescriptorClass();
    
    // 生成模型描述（如果模型已有描述且足够详细，则使用模型的描述）
    let modelDesc = model.description;
    if (!modelDesc || modelDesc.includes('数据库表:') || modelDesc.length < 20) {
      modelDesc = descriptor.generateDescription(model, context);
    }
    
    // 生成表头
    description += `## ${modelNumber}. ${modelName}\n\n`;
    description += `**表名**: \`${tableName}\`\n\n`;
    description += `**语义角色**: ${getSemanticRoleLabel(semanticRole)}\n\n`;
    
    // 生成模型说明
    description += `### 说明\n\n${modelDesc}\n\n`;

    // 生成核心语义信息
    const semanticInfo = [];
    
    // 主键信息
    if (context.primaryKey) {
      let keyDisplayName = context.primaryKey;
      if (context.primaryKey.endsWith('_id')) {
        keyDisplayName = context.primaryKey.replace(/_id$/, '');
      }
      semanticInfo.push(`- **唯一标识**: \`${context.primaryKey}\` (${keyDisplayName})`);
    }
    
    // 外键关联信息
    if (context.foreignKeys.length > 0) {
      context.foreignKeys.slice(0, 3).forEach(fk => {
        semanticInfo.push(`- **关联字段**: \`${fk}\``);
      });
    }
    
    if (semanticInfo.length > 0) {
      description += `### 核心语义\n\n${semanticInfo.join('\n')}\n\n`;
    }

    // 可识别属性
    if (context.identifiableFields.length > 0) {
      const entityType = inferEntityType(modelDesc, context);
      description += `### 可识别属性\n\n`;
      description += `可用于直接识别${entityType}的属性：\n\n`;
      context.identifiableFields.slice(0, 5).forEach(field => {
        description += `- \`${field}\`\n`;
      });
      description += '\n';
    }

    // 维度信息
    if (context.dimensions.length > 0) {
      description += `### 维度字段\n\n`;
      description += `可用于分组、筛选的维度：\n\n`;
      context.dimensions.slice(0, 5).forEach(field => {
        description += `- \`${field}\`\n`;
      });
      description += '\n';
    }

    // 度量信息
    if (context.measures.length > 0) {
      description += `### 度量字段\n\n`;
      description += `可用于聚合计算的度量：\n\n`;
      context.measures.slice(0, 5).forEach(field => {
        description += `- \`${field}\`\n`;
      });
      description += '\n';
    }

    // 业务问题示例
    const businessQuestions = descriptor.generateBusinessQuestions(model, context);
    if (businessQuestions.length > 0) {
      description += `### 典型业务问题\n\n`;
      businessQuestions.forEach((q, idx) => {
        description += `${idx + 1}. ${q}\n`;
      });
      description += '\n';
    }

    // 关键点
    const keyPoints = [];
    
    // 添加描述符生成的关键点
    const descriptorKeyPoints = descriptor.generateKeyPoints(model, context);
    keyPoints.push(...descriptorKeyPoints);
    
    // 添加语义角色特定的关键点
    if (semanticRole === SemanticRole.FACT && context.measures.length > 0) {
      keyPoints.push(`支持按维度聚合计算 ${context.measures.slice(0, 2).join('、')} 等度量值`);
    }
    
    if (keyPoints.length > 0) {
      description += `### 关键语义点\n\n`;
      keyPoints.forEach((point, idx) => {
        description += `${idx + 1}. ${point}\n`;
      });
      description += '\n';
    }

    description += '---\n\n';
  });

  return description;
}

/**
 * 获取语义角色的中文标签
 * @param {string} semanticRole - 语义角色
 * @returns {string} 中文标签
 */
function getSemanticRoleLabel(semanticRole) {
  const labels = {
    [SemanticRole.ENTITY]: '实体 (entity)',
    [SemanticRole.FACT]: '事实表 (fact)',
    [SemanticRole.SNAPSHOT]: '快照 (snapshot)',
    [SemanticRole.EVENT]: '事件 (event)',
  };
  return labels[semanticRole] || semanticRole;
}

/**
 * 推断实体类型
 * @param {string} modelDesc - 模型描述
 * @param {Object} context - 上下文信息
 * @returns {string} 实体类型
 */
function inferEntityType(modelDesc, context) {
  const desc = modelDesc.toLowerCase();
  if (desc.includes('客户') || desc.includes('用户') || desc.includes('人')) {
    return '客户/用户';
  }
  if (desc.includes('商品') || desc.includes('产品') || desc.includes('物品')) {
    return '商品/产品';
  }
  if (desc.includes('订单') || desc.includes('交易')) {
    return '订单/交易';
  }
  return '实体';
}



// 确保模型已创建（如果还没有）
// 注意：模型需要在 MongoDB 连接后才能使用，但可以在连接前创建
let KnowledgeEntry;
try {
  const models = require('~/db/models');
  KnowledgeEntry = models.KnowledgeEntry;
} catch (e) {
  // 如果从 db/models 导入失败，直接创建模型
  logger.debug('[KnowledgeBaseService] 从 db/models 导入失败，尝试直接创建模型');
}

// 如果模型仍未定义，直接创建
if (!KnowledgeEntry) {
  try {
    const createdModels = createModels(mongoose);
    KnowledgeEntry = createdModels.KnowledgeEntry;
  } catch (e) {
    logger.debug('[KnowledgeBaseService] createModels 未包含 KnowledgeEntry，直接创建模型');
  }
}

// 如果仍然未定义，且 MongoDB 已连接，直接创建模型 schema 和 model
// 注意：模型创建会在第一次使用时延迟初始化（在 getKnowledgeEntries 方法中）
// 从编译后的包中导入，或使用本地 JavaScript 文件
let KnowledgeType;
try {
  KnowledgeType = require('@aipyq/data-schemas/schema/knowledgeBase').KnowledgeType;
} catch (e) {
  // 如果包中不可用，尝试从本地文件导入
  try {
    KnowledgeType = require('../../../../packages/data-schemas/src/schema/knowledgeBase').KnowledgeType;
  } catch (e2) {
    // 使用硬编码的值作为后备
    KnowledgeType = {
      SEMANTIC_MODEL: 'semantic_model',
      QA_PAIR: 'qa_pair',
      SYNONYM: 'synonym',
      BUSINESS_KNOWLEDGE: 'business_knowledge',
      FILE: 'file',
    };
  }
}
const EmbeddingService = require('./EmbeddingService');
const VectorDBService = require('./VectorDBService');

/**
 * 知识库管理服务
 * 负责管理语义模型、QA对、同义词、业务知识等知识条目
 */
class KnowledgeBaseService {
  constructor() {
    this.embeddingService = new EmbeddingService();
    this.vectorDBService = new VectorDBService();
    this.useVectorDB = process.env.USE_VECTOR_DB !== 'false'; // 默认启用向量数据库
  }

  /**
   * 添加语义模型到知识库
   * @param {Object} params
   * @param {string} params.userId - 用户ID
   * @param {string} params.semanticModelId - 语义模型ID
   * @param {string} params.databaseName - 数据库名称
   * @param {string} params.tableName - 表名
   * @param {string} params.content - 语义模型内容（JSON字符串或文本）
   * @param {string} [params.entityId] - 实体ID
   * @param {string} [params.parentId] - 父级知识条目ID（用于层级结构）
   * @param {boolean} [params.isDatabaseLevel] - 是否为数据库级别的语义模型
   * @returns {Promise<Object>} 创建的知识条目
   */
  async addSemanticModel({ userId, semanticModelId, databaseName, tableName, content, entityId, parentId, isDatabaseLevel = false, semanticDescription = null, title: customTitle = null, modelType = null }) {
    try {
      // 如果提供了自定义标题，使用自定义标题；否则使用默认标题
      const title = customTitle || (isDatabaseLevel 
        ? `数据库语义模型: ${databaseName}`
        : `语义模型: ${databaseName}.${tableName}`);
      
      // 生成向量嵌入（如果失败，允许没有 embedding）
      let embedding = null;
      try {
        embedding = await this.embeddingService.embedText(content, userId);
        logger.debug(`[KnowledgeBaseService] Generated embedding for semantic model: ${semanticModelId}`);
      } catch (embeddingError) {
        logger.warn(`[KnowledgeBaseService] Failed to generate embedding for semantic model ${semanticModelId}, continuing without embedding:`, embeddingError.message);
        // 继续执行，允许没有 embedding 的知识条目
      }

      // 确保 parentId 是正确的格式（ObjectId 或 null）
      let parentIdValue = null;
      if (parentId) {
        // 如果 parentId 是字符串，尝试转换为 ObjectId
        if (typeof parentId === 'string') {
          try {
            const mongoose = require('mongoose');
            parentIdValue = new mongoose.Types.ObjectId(parentId);
            logger.debug(`[KnowledgeBaseService] 转换 parentId 字符串为 ObjectId: ${parentId} -> ${parentIdValue}`);
          } catch (e) {
            logger.warn(`[KnowledgeBaseService] 无效的 parentId 格式: ${parentId}, 将设置为 null`, e);
            parentIdValue = null;
          }
        } else {
          parentIdValue = parentId;
          logger.debug(`[KnowledgeBaseService] parentId 已经是 ObjectId 格式: ${parentIdValue}`);
        }
      } else {
        logger.debug(`[KnowledgeBaseService] parentId 为 null，这是父级条目`);
      }

      const knowledgeEntry = new KnowledgeEntry({
        user: userId,
        type: KnowledgeType.SEMANTIC_MODEL,
        title,
        content,
        embedding,
        parent_id: parentIdValue,
        metadata: {
          semantic_model_id: semanticModelId,
          database_name: databaseName,
          table_name: tableName,
          entity_id: entityId,
          is_database_level: isDatabaseLevel,
          // 语义模型说明（仅用于展示，不参与向量检索）
          semantic_description: semanticDescription || null,
          // 模型类型（如果提供）
          model_type: modelType || null,
        },
      });

      await knowledgeEntry.save();
      
      // 验证 parent_id 是否正确保存
      const savedEntry = await KnowledgeEntry.findById(knowledgeEntry._id).lean();
      if (parentIdValue) {
        logger.info(`[KnowledgeBaseService] 子级条目保存后验证 - _id: ${savedEntry._id}, parent_id: ${savedEntry.parent_id}, parent_id类型: ${typeof savedEntry.parent_id}, 是否为ObjectId: ${savedEntry.parent_id instanceof require('mongoose').Types.ObjectId}`);
      } else {
        logger.info(`[KnowledgeBaseService] 父级条目保存后验证 - _id: ${savedEntry._id}, parent_id: ${savedEntry.parent_id || 'null'}`);
      }
      
      // 同时存储到向量数据库（如果启用且有 embedding）
      // 注意：semantic_description 不参与向量检索，只存储在 MongoDB 中供展示使用
      if (this.useVectorDB && embedding) {
        try {
          await this.vectorDBService.storeKnowledgeVector({
            knowledgeEntryId: knowledgeEntry._id.toString(),
            userId: userId.toString(),
            type: KnowledgeType.SEMANTIC_MODEL,
            content,
            embedding,
            metadata: {
              semantic_model_id: semanticModelId,
              database_name: databaseName,
              table_name: tableName,
              entity_id: entityId,
              is_database_level: isDatabaseLevel,
              parent_id: parentId || null,
              // 不包含 semantic_description，因为它不参与向量检索
            },
          });
        } catch (vectorError) {
          logger.warn('[KnowledgeBaseService] Failed to store vector in VectorDB, continuing with MongoDB only:', vectorError.message);
        }
      }
      
      logger.info(`[KnowledgeBaseService] 添加语义模型: ${semanticModelId}${isDatabaseLevel ? ' (数据库级别)' : ''}${embedding ? ' (with embedding)' : ' (without embedding)'}`);

      // 确保 toObject() 包含 parent_id 字段
      const result = knowledgeEntry.toObject();
      // 验证 parent_id 是否正确包含在返回结果中
      if (parentIdValue) {
        logger.info(`[KnowledgeBaseService] 返回子级条目 - _id: ${result._id}, parent_id: ${result.parent_id || 'null'}, parent_id类型: ${typeof result.parent_id}`);
      } else {
        logger.info(`[KnowledgeBaseService] 返回父级条目 - _id: ${result._id}, parent_id: ${result.parent_id || 'null'}`);
      }
      return result;
    } catch (error) {
      logger.error('[KnowledgeBaseService] 添加语义模型失败:', error);
      throw error;
    }
  }

  /**
   * 批量添加数据库语义模型（包含数据库级别和表级别）
   * @param {Object} params
   * @param {string} params.userId - 用户ID
   * @param {string} params.databaseName - 数据库名称
   * @param {Array} params.semanticModels - 表级别的语义模型数组
   * @param {string} params.databaseContent - 数据库级别的完整内容（JSON字符串）
   * @param {Object} [params.metadata] - 数据库级别的元数据
   * @returns {Promise<Object>} 包含父级和子级的结果
   */
  async addDatabaseSemanticModel({ userId, databaseName, semanticModels, databaseContent, metadata = {} }) {
    try {
      // 生成语义模型说明（仅用于展示，不参与向量检索）
      const semanticDescription = generateSemanticModelDescription({
        databaseName,
        semanticModels,
      });

      // 1. 先创建数据库级别的父模型
      // 使用metadata中的title，如果没有则使用databaseName
      const parentTitle = metadata.title || databaseName;
      const parentEntry = await this.addSemanticModel({
        userId,
        semanticModelId: databaseName,
        databaseName,
        tableName: '', // 数据库级别没有表名
        content: databaseContent,
        isDatabaseLevel: true,
        entityId: metadata.entity_id,
        semanticDescription, // 传递说明文本
        title: parentTitle, // 使用metadata中的title
        modelType: metadata.model_type, // 使用metadata中的model_type
      });

      // 确保 parentId 是正确的 ObjectId 或字符串格式
      // toObject() 返回的对象中，_id 可能是 ObjectId 或字符串
      let parentId = null;
      if (parentEntry._id) {
        parentId = parentEntry._id.toString ? parentEntry._id.toString() : String(parentEntry._id);
      } else if (parentEntry.id) {
        parentId = String(parentEntry.id);
      }
      
      if (!parentId) {
        logger.error(`[KnowledgeBaseService] 无法获取父级模型ID, parentEntry:`, JSON.stringify(parentEntry, null, 2));
        throw new Error('无法获取父级模型ID');
      }

      logger.info(`[KnowledgeBaseService] 创建父级模型: ${databaseName}, parentId: ${parentId}, parentEntry keys: ${Object.keys(parentEntry).join(', ')}`);

      // 2. 批量创建表级别的子模型
      const childEntries = [];
      for (const model of semanticModels) {
        const childEntry = await this.addSemanticModel({
          userId,
          semanticModelId: model.name || model.model,
          databaseName,
          tableName: model.name || model.model,
          content: JSON.stringify(model),
          parentId: parentId, // 使用字符串格式的 parentId
          isDatabaseLevel: false,
          entityId: metadata.entity_id,
        });
        childEntries.push(childEntry);
        logger.info(`[KnowledgeBaseService] 创建子级模型: ${model.name || model.model}, parentId: ${parentId}, childEntry.parent_id: ${childEntry.parent_id || 'null'}, childEntry._id: ${childEntry._id}`);
      }

      logger.info(`[KnowledgeBaseService] 添加数据库语义模型: ${databaseName} (1个父级 + ${childEntries.length}个子级)`);

      return {
        parent: parentEntry,
        children: childEntries,
        total: 1 + childEntries.length,
      };
    } catch (error) {
      logger.error('[KnowledgeBaseService] 添加数据库语义模型失败:', error);
      throw error;
    }
  }

  /**
   * 检查是否存在重复的QA对
   * @param {string} question - 问题文本
   * @param {string} userId - 用户ID
   * @param {string} [entityId] - 实体ID（数据源ID）
   * @param {number} [minScore=0.85] - 最小相似度阈值
   * @returns {Promise<Object|null>} 如果存在重复则返回已存在的QA对，否则返回null
   */
  async checkDuplicateQA({ question, userId, entityId, minScore = 0.85 }) {
    try {
      // 先尝试在MongoDB中直接查找相同的问题（精确匹配）
      const query = {
        type: KnowledgeType.QA_PAIR,
        'metadata.question': question.trim(),
      };
      
      // 如果指定了entityId，在同一数据源内检查；否则检查所有数据源
      if (entityId) {
        query['metadata.entity_id'] = entityId;
      }

      const existingQA = await KnowledgeEntry.findOne(query);
      if (existingQA) {
        logger.debug(`[KnowledgeBaseService] 发现完全相同的QA对（精确匹配）`);
        return existingQA.toObject();
      }

      // 如果没有精确匹配，使用向量相似度搜索（如果启用了向量数据库）
      if (this.useVectorDB) {
        try {
          const questionEmbedding = await this.embeddingService.embedText(question, userId);
          if (questionEmbedding) {
            const similarResults = await this.vectorDBService.searchSimilar({
              queryEmbedding: questionEmbedding,
              type: KnowledgeType.QA_PAIR,
              topK: 1,
              minScore,
              entityId, // 在同一数据源内搜索
            });

            if (similarResults && similarResults.length > 0) {
              const topResult = similarResults[0];
              if (topResult.score >= minScore) {
                logger.debug(`[KnowledgeBaseService] 发现相似的QA对（相似度: ${topResult.score.toFixed(3)}）`);
                // 从MongoDB获取完整信息
                const existingEntry = await KnowledgeEntry.findById(topResult.knowledgeEntryId);
                if (existingEntry) {
                  return existingEntry.toObject();
                }
              }
            }
          }
        } catch (vectorError) {
          logger.warn('[KnowledgeBaseService] 向量相似度检查失败，继续执行:', vectorError.message);
        }
      }

      return null;
    } catch (error) {
      logger.warn('[KnowledgeBaseService] 检查重复QA失败:', error);
      return null; // 出错时不阻止添加
    }
  }

  /**
   * 添加QA对到知识库
   * @param {Object} params
   * @param {string} params.userId - 用户ID
   * @param {string} params.question - 问题
   * @param {string} params.answer - 答案
   * @param {string} [params.entityId] - 实体ID（数据源ID）
   * @param {boolean} [params.skipDuplicateCheck=false] - 是否跳过去重检查
   * @returns {Promise<Object>} 创建的知识条目（如果已存在则返回已存在的条目）
   */
  async addQAPair({ userId, question, answer, entityId, skipDuplicateCheck = false }) {
    try {
      // 去重检查（除非明确跳过）
      if (!skipDuplicateCheck) {
        const duplicate = await this.checkDuplicateQA({ question, userId, entityId });
        if (duplicate) {
          logger.info(`[KnowledgeBaseService] QA对已存在，跳过添加: ${question.substring(0, 30)}...`);
          return duplicate;
        }
      }

      // 将问题和答案组合作为内容
      const content = `问题: ${question}\n答案: ${answer}`;
      const title = `QA: ${question.substring(0, 50)}${question.length > 50 ? '...' : ''}`;

      // 生成向量嵌入（使用问题作为主要向量化内容，如果失败则允许没有 embedding）
      let embedding = null;
      try {
        embedding = await this.embeddingService.embedText(question, userId);
        logger.debug(`[KnowledgeBaseService] Generated embedding for QA pair`);
      } catch (embeddingError) {
        logger.warn(`[KnowledgeBaseService] Failed to generate embedding for QA pair, continuing without embedding:`, embeddingError.message);
      }

      const knowledgeEntry = new KnowledgeEntry({
        user: userId,
        type: KnowledgeType.QA_PAIR,
        title,
        content,
        embedding,
        metadata: {
          question,
          answer,
          entity_id: entityId,
        },
      });

      await knowledgeEntry.save();

      // 同时存储到向量数据库（如果启用且有 embedding）
      if (this.useVectorDB && embedding) {
        try {
          await this.vectorDBService.storeKnowledgeVector({
            knowledgeEntryId: knowledgeEntry._id.toString(),
            userId: userId.toString(),
            type: KnowledgeType.QA_PAIR,
            content,
            embedding,
            metadata: {
              question,
              answer,
              entity_id: entityId,
            },
          });
        } catch (vectorError) {
          logger.warn('[KnowledgeBaseService] Failed to store vector in VectorDB, continuing with MongoDB only:', vectorError.message);
        }
      }

      logger.info(`[KnowledgeBaseService] 添加QA对: ${question.substring(0, 30)}...${embedding ? ' (with embedding)' : ' (without embedding)'}`);

      return knowledgeEntry.toObject();
    } catch (error) {
      logger.error('[KnowledgeBaseService] 添加QA对失败:', error);
      throw error;
    }
  }

  /**
   * 添加同义词到知识库
   * @param {Object} params
   * @param {string} params.userId - 用户ID
   * @param {string} params.noun - 名词
   * @param {string[]} params.synonyms - 同义词数组
   * @param {string} [params.entityId] - 实体ID
   * @returns {Promise<Object>} 创建的知识条目
   */
  async addSynonym({ userId, noun, synonyms, entityId }) {
    try {
      const synonymsText = synonyms.join(', ');
      const content = `名词: ${noun}\n同义词: ${synonymsText}`;
      const title = `同义词: ${noun}`;

      // 生成向量嵌入（使用名词和同义词组合，如果失败则允许没有 embedding）
      let embedding = null;
      try {
        embedding = await this.embeddingService.embedText(content, userId);
        logger.debug(`[KnowledgeBaseService] Generated embedding for synonym`);
      } catch (embeddingError) {
        logger.warn(`[KnowledgeBaseService] Failed to generate embedding for synonym, continuing without embedding:`, embeddingError.message);
      }

      const knowledgeEntry = new KnowledgeEntry({
        user: userId,
        type: KnowledgeType.SYNONYM,
        title,
        content,
        embedding,
        metadata: {
          noun,
          synonyms,
          entity_id: entityId,
        },
      });

      await knowledgeEntry.save();

      // 同时存储到向量数据库（如果启用且有 embedding）
      if (this.useVectorDB && embedding) {
        try {
          await this.vectorDBService.storeKnowledgeVector({
            knowledgeEntryId: knowledgeEntry._id.toString(),
            userId: userId.toString(),
            type: KnowledgeType.SYNONYM,
            content,
            embedding,
            metadata: {
              noun,
              synonyms,
              entity_id: entityId,
            },
          });
        } catch (vectorError) {
          logger.warn('[KnowledgeBaseService] Failed to store vector in VectorDB, continuing with MongoDB only:', vectorError.message);
        }
      }

      logger.info(`[KnowledgeBaseService] 添加同义词: ${noun}${embedding ? ' (with embedding)' : ' (without embedding)'}`);

      return knowledgeEntry.toObject();
    } catch (error) {
      logger.error('[KnowledgeBaseService] 添加同义词失败:', error);
      throw error;
    }
  }

  /**
   * 添加业务知识到知识库
   * @param {Object} params
   * @param {string} params.userId - 用户ID
   * @param {string} params.title - 标题
   * @param {string} params.content - 内容
   * @param {string} [params.category] - 分类
   * @param {string[]} [params.tags] - 标签
   * @param {string} [params.entityId] - 实体ID
   * @returns {Promise<Object>} 创建的知识条目
   */
  async addBusinessKnowledge({ userId, title, content, category, tags, entityId, fileId, filename }) {
    try {
      // 修复文件名编码问题（multer 可能将 UTF-8 文件名错误地按 Latin1 解码）
      const { fixFilenameEncoding } = require('~/server/utils/files');
      const decodedFilename = filename ? fixFilenameEncoding(filename) : filename;
      let decodedTitle = title ? fixFilenameEncoding(title) : title;
      
      // 如果 title 未提供或与 filename 相同，使用文件名作为 title
      if (!decodedTitle && decodedFilename) {
        decodedTitle = decodedFilename;
      }

      // 如果有关联的文件，文件已经通过上传 API 向量化，不需要再次生成 embedding
      // 否则，为文本内容生成向量嵌入
      let embedding = null;
      if (!fileId && content) {
        try {
          embedding = await this.embeddingService.embedText(content, userId);
          logger.debug(`[KnowledgeBaseService] Generated embedding for business knowledge`);
        } catch (embeddingError) {
          logger.warn(`[KnowledgeBaseService] Failed to generate embedding for business knowledge, continuing without embedding:`, embeddingError.message);
        }
      } else if (fileId) {
        logger.debug(`[KnowledgeBaseService] Business knowledge linked to file ${fileId}, file already vectorized`);
      }

      // 确保 userId 转换为 ObjectId 格式
      const mongoose = require('mongoose');
      let userIdObjectId = userId;
      if (typeof userId === 'string' && mongoose.connection.readyState === 1) {
        try {
          userIdObjectId = new mongoose.Types.ObjectId(userId);
        } catch (e) {
          // 如果转换失败，使用原始值
          userIdObjectId = userId;
        }
      }
      
      const knowledgeEntry = new KnowledgeEntry({
        user: userIdObjectId,
        type: KnowledgeType.BUSINESS_KNOWLEDGE,
        title: decodedTitle,
        content: content || (fileId ? `文档: ${decodedFilename || '已上传文档'}` : ''),
        embedding,
        parent_id: null, // 明确设置为 null，确保是父级条目
        metadata: {
          category,
          tags: tags || [],
          entity_id: entityId,
          file_id: fileId, // 关联的文件ID
          filename: decodedFilename, // 文件名（已解码）
        },
      });

      await knowledgeEntry.save();

      // 同时存储到向量数据库（如果启用且有 embedding）
      // 注意：如果有关联的文件，文件已经通过上传 API 向量化，不需要再次存储
      if (this.useVectorDB && embedding && !fileId) {
        try {
          await this.vectorDBService.storeKnowledgeVector({
            knowledgeEntryId: knowledgeEntry._id.toString(),
            userId: userId.toString(),
            type: KnowledgeType.BUSINESS_KNOWLEDGE,
            content,
            embedding,
            metadata: {
              category,
              tags: tags || [],
              entity_id: entityId,
              file_id: fileId,
              filename: decodedFilename, // 使用修复后的文件名
            },
          });
        } catch (vectorError) {
          logger.warn('[KnowledgeBaseService] Failed to store vector in VectorDB, continuing with MongoDB only:', vectorError.message);
        }
      }

      // 确保日志输出时文件名正确
      const logTitle = decodedTitle || decodedFilename || '未知文件';
      // 使用 Buffer 确保日志输出时编码正确
      try {
        const logTitleBuffer = Buffer.from(logTitle, 'utf8');
        const logTitleStr = logTitleBuffer.toString('utf8');
        logger.info(`[KnowledgeBaseService] 添加业务知识: ${logTitleStr}${embedding ? ' (with embedding)' : ' (without embedding)'}`);
      } catch (logError) {
        logger.info(`[KnowledgeBaseService] 添加业务知识: ${logTitle}${embedding ? ' (with embedding)' : ' (without embedding)'}`);
      }

      return knowledgeEntry.toObject();
    } catch (error) {
      logger.error('[KnowledgeBaseService] 添加业务知识失败:', error);
      throw error;
    }
  }

  /**
   * 更新QA对
   * @param {Object} params
   * @param {string} params.entryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @param {string} params.question - 问题
   * @param {string} params.answer - 答案
   * @returns {Promise<Object>} 更新后的知识条目
   */
  async updateQAPair({ entryId, userId, question, answer }) {
    try {
      const entry = await KnowledgeEntry.findOne({ _id: entryId, user: userId });
      if (!entry) {
        throw new Error('知识条目不存在或无权修改');
      }

      const content = `问题: ${question}\n答案: ${answer}`;
      const title = `QA: ${question.substring(0, 50)}${question.length > 50 ? '...' : ''}`;

      // 重新生成向量嵌入
      let embedding = null;
      try {
        embedding = await this.embeddingService.embedText(question, userId);
      } catch (embeddingError) {
        logger.warn(`[KnowledgeBaseService] Failed to regenerate embedding for QA pair, continuing without embedding:`, embeddingError.message);
      }

      entry.title = title;
      entry.content = content;
      entry.embedding = embedding;
      entry.metadata = {
        ...entry.metadata,
        question,
        answer,
      };
      entry.updatedAt = new Date();

      await entry.save();

      // 更新向量数据库
      if (this.useVectorDB && embedding) {
        try {
          await this.vectorDBService.updateKnowledgeVector({
            knowledgeEntryId: entry._id.toString(),
            userId: userId.toString(),
            type: KnowledgeType.QA_PAIR,
            content,
            embedding,
            metadata: entry.metadata,
          });
        } catch (vectorError) {
          logger.warn('[KnowledgeBaseService] Failed to update vector in VectorDB:', vectorError.message);
        }
      }

      logger.info(`[KnowledgeBaseService] 更新QA对: ${entryId}`);
      return entry.toObject();
    } catch (error) {
      logger.error('[KnowledgeBaseService] 更新QA对失败:', error);
      throw error;
    }
  }

  /**
   * 更新同义词
   * @param {Object} params
   * @param {string} params.entryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @param {string} params.noun - 名词
   * @param {string[]} params.synonyms - 同义词数组
   * @returns {Promise<Object>} 更新后的知识条目
   */
  async updateSynonym({ entryId, userId, noun, synonyms }) {
    try {
      const entry = await KnowledgeEntry.findOne({ _id: entryId, user: userId });
      if (!entry) {
        throw new Error('知识条目不存在或无权修改');
      }

      const synonymsText = synonyms.join(', ');
      const content = `名词: ${noun}\n同义词: ${synonymsText}`;
      const title = `同义词: ${noun}`;

      // 重新生成向量嵌入
      let embedding = null;
      try {
        embedding = await this.embeddingService.embedText(content, userId);
      } catch (embeddingError) {
        logger.warn(`[KnowledgeBaseService] Failed to regenerate embedding for synonym, continuing without embedding:`, embeddingError.message);
      }

      entry.title = title;
      entry.content = content;
      entry.embedding = embedding;
      entry.metadata = {
        ...entry.metadata,
        noun,
        synonyms,
      };
      entry.updatedAt = new Date();

      await entry.save();

      // 更新向量数据库
      if (this.useVectorDB && embedding) {
        try {
          await this.vectorDBService.updateKnowledgeVector({
            knowledgeEntryId: entry._id.toString(),
            userId: userId.toString(),
            type: KnowledgeType.SYNONYM,
            content,
            embedding,
            metadata: entry.metadata,
          });
        } catch (vectorError) {
          logger.warn('[KnowledgeBaseService] Failed to update vector in VectorDB:', vectorError.message);
        }
      }

      logger.info(`[KnowledgeBaseService] 更新同义词: ${entryId}`);
      return entry.toObject();
    } catch (error) {
      logger.error('[KnowledgeBaseService] 更新同义词失败:', error);
      throw error;
    }
  }

  /**
   * 更新业务知识
   * @param {Object} params
   * @param {string} params.entryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @param {string} params.title - 标题
   * @param {string} params.content - 内容
   * @param {string} [params.category] - 分类
   * @param {string[]} [params.tags] - 标签
   * @returns {Promise<Object>} 更新后的知识条目
   */
  async updateBusinessKnowledge({ entryId, userId, title, content, category, tags }) {
    try {
      const entry = await KnowledgeEntry.findOne({ _id: entryId, user: userId });
      if (!entry) {
        throw new Error('知识条目不存在或无权修改');
      }

      // 如果有关联的文件，不需要重新生成 embedding
      const fileId = entry.metadata?.file_id;
      let embedding = entry.embedding; // 保留原有 embedding

      // 只在提供了 content 且没有关联文件时才重新生成 embedding
      if (!fileId && content !== undefined && content !== null) {
        // 重新生成向量嵌入
        try {
          embedding = await this.embeddingService.embedText(content, userId);
        } catch (embeddingError) {
          logger.warn(`[KnowledgeBaseService] Failed to regenerate embedding for business knowledge, continuing without embedding:`, embeddingError.message);
        }
      }

      // 只在提供了相应字段时才更新，避免覆盖必需字段
      if (title !== undefined && title !== null) {
        entry.title = title;
      }
      if (content !== undefined && content !== null) {
        entry.content = content;
      }
      if (embedding) {
        entry.embedding = embedding;
      }
      
      // 更新 metadata，只更新提供的字段
      if (category !== undefined || tags !== undefined) {
        entry.metadata = {
          ...entry.metadata,
          ...(category !== undefined && { category }),
          ...(tags !== undefined && { tags }),
        };
      }
      
      entry.updatedAt = new Date();

      await entry.save();

      // 更新向量数据库（如果有关联文件，文件已经向量化，不需要更新）
      if (this.useVectorDB && embedding && !fileId) {
        try {
          await this.vectorDBService.updateKnowledgeVector({
            knowledgeEntryId: entry._id.toString(),
            userId: userId.toString(),
            type: KnowledgeType.BUSINESS_KNOWLEDGE,
            content: entry.content,
            embedding,
            metadata: entry.metadata,
          });
        } catch (vectorError) {
          logger.warn('[KnowledgeBaseService] Failed to update vector in VectorDB:', vectorError.message);
        }
      }

      logger.info(`[KnowledgeBaseService] 更新业务知识: ${entryId}`);
      return entry.toObject();
    } catch (error) {
      logger.error('[KnowledgeBaseService] 更新业务知识失败:', error);
      throw error;
    }
  }

  /**
   * 批量添加知识条目
   * @param {Object} params
   * @param {string} params.userId - 用户ID
   * @param {Array} params.entries - 知识条目数组
   * @returns {Promise<Object[]>} 创建的知识条目数组
   */
  async addKnowledgeEntries({ userId, entries }) {
    try {
      const results = [];

      for (const entry of entries) {
        const { type, ...params } = entry;

        switch (type) {
          case KnowledgeType.SEMANTIC_MODEL:
            results.push(await this.addSemanticModel({ userId, ...params }));
            break;
          case KnowledgeType.QA_PAIR:
            results.push(await this.addQAPair({ userId, ...params }));
            break;
          case KnowledgeType.SYNONYM:
            results.push(await this.addSynonym({ userId, ...params }));
            break;
          case KnowledgeType.BUSINESS_KNOWLEDGE:
            results.push(await this.addBusinessKnowledge({ userId, ...params }));
            break;
          default:
            logger.warn(`[KnowledgeBaseService] 未知的知识类型: ${type}`);
        }
      }

      return results;
    } catch (error) {
      logger.error('[KnowledgeBaseService] 批量添加知识条目失败:', error);
      throw error;
    }
  }

  /**
   * 删除知识条目
   * @param {Object} params
   * @param {string} params.entryId - 知识条目ID
   * @param {string} params.userId - 用户ID（用于权限验证）
   * @returns {Promise<boolean>} 是否删除成功
   */
  async deleteKnowledgeEntry({ entryId, userId }) {
    try {
      // 先获取条目信息，检查是否有子项
      const entry = await KnowledgeEntry.findOne({ _id: entryId, user: userId }).lean();
      if (!entry) {
        logger.warn(`[KnowledgeBaseService] 删除失败：未找到知识条目 ${entryId}`);
        return false;
      }

      // 如果删除的是父级（parent_id 为 null），同时删除所有子项
      if (!entry.parent_id) {
        const children = await KnowledgeEntry.find({
          parent_id: entryId,
          user: userId,
        }).lean();

        logger.info(`[KnowledgeBaseService] 删除父级条目 ${entryId}，同时删除 ${children.length} 个子项`);

        // 删除所有子项的向量（如果启用）
        if (this.useVectorDB && children.length > 0) {
          for (const child of children) {
            try {
              // 删除知识向量
              await this.vectorDBService.deleteKnowledgeVector(child._id.toString(), child.type);
              
              // 如果子项关联了文件，同时删除文件向量
              const childFileId = child.metadata?.file_id;
              if (childFileId) {
                try {
                  await this.vectorDBService.deleteFileVectors(childFileId);
                  logger.info(`[KnowledgeBaseService] 已删除子项关联的文件向量: fileId=${childFileId}`);
                } catch (fileVectorError) {
                  logger.warn(`[KnowledgeBaseService] Failed to delete child file vectors for fileId=${childFileId}:`, fileVectorError.message);
                }
              }
            } catch (vectorError) {
              logger.warn(`[KnowledgeBaseService] Failed to delete child vector from VectorDB: ${child._id}`, vectorError.message);
            }
          }
        }

        // 删除所有子项
        const childrenDeleteResult = await KnowledgeEntry.deleteMany({
          parent_id: entryId,
          user: userId,
        });
        logger.info(`[KnowledgeBaseService] 已删除 ${childrenDeleteResult.deletedCount} 个子项`);
      }

      // 删除主条目
      const result = await KnowledgeEntry.deleteOne({
        _id: entryId,
        user: userId,
      });

      if (result.deletedCount > 0) {
        // 同时从向量数据库删除（如果启用）
        if (this.useVectorDB) {
          try {
            // 删除知识向量（business_knowledge 等）
            await this.vectorDBService.deleteKnowledgeVector(entryId.toString(), entry.type);
            
            // 如果知识条目关联了文件，同时删除文件向量（file_vectors 表）
            const fileId = entry.metadata?.file_id;
            if (fileId) {
              try {
                await this.vectorDBService.deleteFileVectors(fileId);
                logger.info(`[KnowledgeBaseService] 已删除关联的文件向量: fileId=${fileId}`);
              } catch (fileVectorError) {
                logger.warn(`[KnowledgeBaseService] Failed to delete file vectors for fileId=${fileId}:`, fileVectorError.message);
              }
            }
          } catch (vectorError) {
            logger.warn('[KnowledgeBaseService] Failed to delete vector from VectorDB:', vectorError.message);
          }
        }

        logger.info(`[KnowledgeBaseService] 删除知识条目: ${entryId} (类型: ${entry.type})`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('[KnowledgeBaseService] 删除知识条目失败:', error);
      throw error;
    }
  }

  /**
   * 获取知识条目列表
   * 
   * @param {Object} params
   * @param {string} [params.userId] - 用户ID（可选，用于过滤特定用户创建的知识）
   * @param {string} [params.type] - 知识类型过滤
   * @param {string} [params.entityId] - 实体ID过滤
   * @param {boolean} [params.includeChildren] - 是否包含子项（默认只返回父级）
   * @param {number} [params.limit] - 限制数量
   * @param {number} [params.skip] - 跳过数量
   * @returns {Promise<Object[]>} 知识条目数组
   */
  async getKnowledgeEntries({ userId, type, entityId, includeChildren = false, limit = 100, skip = 0 }) {
    try {
      // 确保 KnowledgeEntry 模型已初始化
      if (!KnowledgeEntry) {
        logger.warn('[KnowledgeBaseService] KnowledgeEntry model is not initialized, attempting to create');
        // 尝试重新初始化
        try {
          const models = require('~/db/models');
          KnowledgeEntry = models.KnowledgeEntry;
        } catch (e) {
          logger.debug('[KnowledgeBaseService] 从 db/models 导入失败');
        }
        
        if (!KnowledgeEntry) {
          try {
            const createdModels = createModels(mongoose);
            KnowledgeEntry = createdModels.KnowledgeEntry;
          } catch (e) {
            logger.debug('[KnowledgeBaseService] createModels 未包含 KnowledgeEntry');
          }
        }
        
        // 如果仍然未定义，直接创建模型
        if (!KnowledgeEntry && mongoose.connection.readyState === 1) {
          const KnowledgeEntrySchema = new mongoose.Schema({
            user: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
              index: true,
              required: true,
            },
            type: {
              type: String,
              required: true,
              index: true,
            },
            title: {
              type: String,
              required: true,
            },
            content: {
              type: String,
            },
            embedding: {
              type: [Number],
            },
            parent_id: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'KnowledgeEntry',
              default: null,
              index: true,
            },
            metadata: {
              type: mongoose.Schema.Types.Mixed,
              default: {},
            },
          }, {
            timestamps: true,
            collection: 'knowledge_entries',
          });

          if (!mongoose.models.KnowledgeEntry) {
            KnowledgeEntry = mongoose.model('KnowledgeEntry', KnowledgeEntrySchema);
            logger.info('[KnowledgeBaseService] KnowledgeEntry 模型已在运行时创建');
          } else {
            KnowledgeEntry = mongoose.models.KnowledgeEntry;
          }
        }
        
        // 如果仍然未定义，抛出错误
        if (!KnowledgeEntry) {
          throw new Error('KnowledgeEntry model could not be initialized. MongoDB connection may not be ready.');
        }
      }

      const query = {};

      // userId改为可选，如果提供则过滤，否则查询所有
      // 确保 userId 转换为 ObjectId 格式（如果 MongoDB 已连接）
      if (userId) {
        const mongoose = require('mongoose');
        // 如果 userId 是字符串且 MongoDB 已连接，转换为 ObjectId
        if (typeof userId === 'string' && mongoose.connection.readyState === 1) {
          try {
            query.user = new mongoose.Types.ObjectId(userId);
          } catch (e) {
            // 如果转换失败，使用原始值（可能是其他格式的ID）
            query.user = userId;
          }
        } else {
          query.user = userId;
        }
      }

      if (type) {
        query.type = type;
      }

      if (entityId) {
        query['metadata.entity_id'] = entityId;
      }

      // 无论 includeChildren 是否为 true，查询时都只返回父级（parent_id 为 null 或不存在的条目）
      // 如果 includeChildren 为 true，会在后面单独加载子项
      // 在 MongoDB 中，由于 schema 中 parent_id 的 default 是 null，所以父级条目的 parent_id 都是 null
      // 直接查询 parent_id 为 null 即可（这会匹配字段值为 null 的情况）
      // 如果字段不存在，使用 $in: [null] 可以同时匹配 null 和不存在的字段
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { parent_id: null },
          { parent_id: { $exists: false } }
        ]
      });

      const entries = await KnowledgeEntry.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean();

      logger.info(`[KnowledgeBaseService] 查询父级结果: ${entries.length} 条，includeChildren: ${includeChildren}, type: ${type}, userId: ${userId || '未提供'}, query: ${JSON.stringify(query)}`);
      if (entries.length > 0 && (type === 'semantic_model' || type === 'business_knowledge')) {
        entries.forEach((entry, index) => {
          logger.info(`[KnowledgeBaseService] 父级条目 ${index + 1}: _id=${entry._id}, parent_id=${entry.parent_id || 'null'}, title=${entry.title}, user=${entry.user}`);
        });
      } else if (entries.length === 0 && (type === 'semantic_model' || type === 'business_knowledge')) {
        // 如果查询结果为空，尝试查询所有条目看看是否有数据
        const allEntriesQuery = { type: type };
        if (userId) {
          allEntriesQuery.user = userId;
        }
        const allEntries = await KnowledgeEntry.find(allEntriesQuery).limit(5).lean();
        logger.warn(`[KnowledgeBaseService] 查询父级结果为空，但数据库中有 ${allEntries.length} 条${type}条目（前5条）`);
        allEntries.forEach((entry, index) => {
          logger.warn(`[KnowledgeBaseService] 条目 ${index + 1}: _id=${entry._id}, parent_id=${entry.parent_id || 'null'}, title=${entry.title}, user=${entry.user}, type=${entry.type}`);
        });
      }

      // 如果请求包含子项，为每个父级加载子项
      if (includeChildren && entries.length > 0) {
        const mongoose = require('mongoose');
        const parentIds = entries
          .filter(e => !e.parent_id)
          .map(e => {
            // 确保 _id 是 ObjectId 格式
            if (e._id instanceof mongoose.Types.ObjectId) {
              return e._id;
            }
            return new mongoose.Types.ObjectId(e._id);
          });
        
        if (parentIds.length > 0) {
          const childrenQuery = {
            parent_id: { $in: parentIds },
          };
          
          // userId改为可选
          if (userId) {
            childrenQuery.user = userId;
          }
          
          // 如果提供了 entityId，子项查询也需要过滤 entityId，确保数据源隔离
          if (entityId) {
            childrenQuery['metadata.entity_id'] = entityId;
          }
          
          const children = await KnowledgeEntry.find(childrenQuery)
            .sort({ createdAt: -1 })
            .lean();

          // 将子项附加到父级
          const childrenMap = new Map();
          children.forEach(child => {
            const parentId = child.parent_id?.toString();
            if (parentId) {
              if (!childrenMap.has(parentId)) {
                childrenMap.set(parentId, []);
              }
              childrenMap.get(parentId).push(child);
            }
          });

          entries.forEach(entry => {
            const entryId = entry._id.toString();
            if (childrenMap.has(entryId)) {
              entry.children = childrenMap.get(entryId);
              logger.debug(`[KnowledgeBaseService] 条目 ${entry.title} 有 ${entry.children.length} 个子项`);
            } else {
              entry.children = []; // 确保所有条目都有 children 字段
            }
          });
          
          logger.info(`[KnowledgeBaseService] 加载子项完成，共 ${entries.length} 个父级，${children.length} 个子项`);
        } else {
          // 如果没有父级，确保所有条目都有 children 字段
          entries.forEach(entry => {
            entry.children = [];
          });
        }
      } else {
        // 如果不需要子项，确保所有条目都没有 children 字段（或设为空数组）
        entries.forEach(entry => {
          entry.children = [];
        });
      }

      logger.info(`[KnowledgeBaseService] 最终返回 ${entries.length} 条条目（全部为父级）`);
      return entries;
    } catch (error) {
      logger.error('[KnowledgeBaseService] 获取知识条目失败:', error);
      throw error;
    }
  }
}

module.exports = KnowledgeBaseService;

