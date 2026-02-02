# 写作助手模板系统

公文写作辅助工具的模板系统，支持多种公文类型的规范化写作。

## 目录结构

```
writing-templates/
├── README.md                 # 本文件
├── TOOL_USAGE.md             # 工具使用指南
├── commands/                 # 命令模板
│   ├── clarify-command.md    # 需求澄清命令
│   └── generate-command.md   # 内容生成命令
├── templates/                # 文书模板
│   ├── general-template.md   # 通用模板
│   ├── official-documents/   # 公文模板
│   ├── speeches/             # 讲话模板
│   ├── proposals/            # 方案模板
│   └── letters/              # 函件模板
├── guides/                   # 写作指南
│   ├── tone-guide.md         # 语气风格指南
│   └── format-guide.md       # 格式规范指南
└── variable-system/          # 变量系统
    └── variable-reference.md # 变量参考
```

## 支持的文书类型

| 类型 | 场景值 | 适用场景 |
|------|--------|----------|
| 工作报告/总结 | `report` | 年度总结、调研报告、述职报告 |
| 请示/函件 | `letter` | 请示、批复、通知、通报、公函 |
| 讲话/致辞 | `speech` | 领导讲话、开幕词、欢迎词 |
| 简报/汇报 | `briefing` | 工作简报、进度汇报 |
| 方案/计划 | `proposal` | 实施方案、工作计划、建议书 |
| 会议纪要 | `memo` | 会议纪要、备忘录 |
| 通用 | `general` | 其他正式文书 |

## 使用流程

1. **澄清需求** - 使用 `/writing.clarify` 命令收集写作需求
2. **生成大纲** - 使用 `/writing.outline` 命令生成写作大纲
3. **生成内容** - 使用 `/writing.generate` 命令生成完整内容
4. **润色优化** - 使用 `/writing.refine` 命令优化内容

## 命令说明

### clarify - 需求澄清

收集以下信息：
- 收文对象（给谁看）
- 场景类型（什么类型的文书）
- 写作背景和目的
- 目标字数
- 语气风格
- 关键要点
- 参考资料

### generate - 内容生成

根据澄清的需求生成完整的公文内容。

### templates - 模板列表

列出所有可用的模板及其适用场景。

### refine - 润色优化

对已有内容进行润色，包括：
- 用词规范化
- 结构优化
- 语气调整
- 格式规范

### outline - 生成大纲

根据需求生成详细的写作大纲。

## 变量系统

模板中使用以下占位符：

| 变量 | 说明 |
|------|------|
| `{{date}}` | 当前日期 |
| `{{year}}` | 当前年份 |
| `{{month}}` | 当前月份 |
| `{{recipient}}` | 收文对象 |
| `{{title}}` | 文书标题 |
| `{{content}}` | 主体内容 |
| `{{signature}}` | 落款单位 |
