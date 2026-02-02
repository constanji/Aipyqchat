# 写作助手工具使用指南

## 工具概述

写作助手（WritingAssistant）是一个公文写作辅助工具，通过结构化的需求澄清和模板系统，帮助用户高效完成各类公文写作。

## 快速开始

### 1. 基本用法

```
/writing.clarify 帮我写一份给处长的年度工作总结
```

工具会自动识别场景（report）并引导你完善需求信息。

### 2. 直接生成

```
/writing.generate 写一份关于项目进展的汇报，给王处长看，大约1000字
```

### 3. 生成大纲

```
/writing.outline 写一份实施方案，关于数字化转型
```

## 命令详解

### clarify - 需求澄清

**用途**：交互式收集写作需求，确保信息完整

**参数**：
- `arguments`: 初始描述
- `recipient_type`: 收文对象类型
- `recipient_title`: 具体职务
- `scenario`: 场景类型
- `context`: 背景描述
- `word_count`: 目标字数
- `tone`: 语气风格
- `key_points`: 关键要点
- `references`: 参考资料

**示例**：
```
/writing.clarify 
arguments: "给局长写一份关于上半年工作的汇报"
recipient_type: "上级领导"
word_count: 2000
tone: "formal"
```

### generate - 内容生成

**用途**：根据需求生成完整公文

**参数**：
- `arguments`: 写作需求描述
- `scenario`: 场景类型（可自动检测）
- 其他与clarify相同的字段

**示例**：
```
/writing.generate
arguments: "写一份项目启动会的领导讲话稿"
scenario: "speech"
word_count: 1500
tone: "formal"
key_points: "强调项目重要性，部署工作要求"
```

### templates - 模板列表

**用途**：查看可用模板

**示例**：
```
/writing.templates
```

### refine - 润色优化

**用途**：优化已有内容

**参数**：
- `content`: 待优化的内容
- `feedback`: 优化方向

**示例**：
```
/writing.refine
content: "（需要润色的内容）"
feedback: "语气更正式一些，增加数据支撑"
```

### outline - 生成大纲

**用途**：生成写作大纲

**参数**：
- `arguments`: 写作需求描述
- `scenario`: 场景类型

**示例**：
```
/writing.outline
arguments: "写一份2024年工作计划"
scenario: "proposal"
word_count: 3000
```

## 场景类型

| 场景 | 关键词 | 典型用途 |
|------|--------|----------|
| `report` | 报告、总结、汇报 | 工作报告、年度总结 |
| `letter` | 请示、批复、函 | 请示报告、工作通知 |
| `speech` | 讲话、发言、致辞 | 领导讲话、开幕词 |
| `briefing` | 简报、进展 | 工作简报、进度汇报 |
| `proposal` | 方案、计划、建议 | 实施方案、工作计划 |
| `memo` | 纪要、备忘 | 会议纪要 |

## 最佳实践

1. **先澄清后生成**：复杂文书建议先用 `clarify` 完善需求
2. **善用大纲**：长文档先生成大纲，确认结构后再生成内容
3. **迭代优化**：使用 `refine` 命令逐步优化内容
4. **明确受众**：清晰说明收文对象，工具会调整语气风格

## 注意事项

- 生成的内容仅供参考，请根据实际情况调整
- 涉及具体数据、日期等信息需自行核实
- 正式文件请遵循本单位公文格式规范
