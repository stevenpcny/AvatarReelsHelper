# AvatarReelsHelper 架构文档

## 项目概览

AvatarReelsHelper 是一个 AI 驱动的文案质检工具，帮助用户快速发现和修正英文文案中的语法、拼写和格式问题。

**技术栈**：
- **前端**: React + TypeScript + Tailwind CSS
- **后端**: FastAPI (Python) 代理 Google Vertex AI API
- **认证**: Workload Identity（Google Cloud Run 原生认证，无需 API 密钥）
- **模型链**: gemini-2.5-flash-lite → gemini-2.5-flash（故障转移）
- **部署**: Google Cloud Run（git push main 自动触发 Cloud Build）

---

## 核心功能实现

### 1. TSV 格式支持

**功能**: 支持 Tab 分隔的输入格式（序号[TAB]中文[TAB]英文）

**实现位置**: `src/App.tsx` - `handleAuditCopy()` 函数

**工作原理**:
- **格式检测**: 通过正则表达式 `/^\d+\t/m` 识别 TSV 格式
- **行边界识别**: 使用 `/^(\d+)\t/gm` 找到每一行的开始
- **列分割**: 按第一个 tab 字符分割每一行，提取中文和英文列
- **多行字段支持**: 支持多行引号字段，通过 `stripQuotes()` 函数清理引号
- **向后兼容**: 如果不是 TSV 格式，自动使用原有的内联解析器（`1. 中文 English`）

**代码实现示例**:
```javascript
const isTSV = /^\d+\t/m.test(textToProcess);
if (isTSV) {
  // TSV 解析逻辑
  const rows = textToProcess.match(/^(\d+)\t/gm);
  // 对每一行进行处理
  // 按第一个 tab 分割以提取列
}
```

**支持的输入格式**:
```
1	"中文文案"	"English text"
2	"另一条"	"Another one"
```

### 2. 多选复制功能

**功能**: 在审计结果列表顶部添加全选框，一次性复制所有英文文案到剪贴板

**实现位置**: `src/App.tsx` - 审计结果渲染部分

**交互流程**:
1. 审计结果列表标题左侧显示全选复选框
2. 用户点击全选框
3. 自动收集所有英文内容
4. 使用 `navigator.clipboard.writeText()` 复制到系统剪贴板
5. 显示成功反馈（toast 提示）

**优势**:
- 一键复制多个文案，提高工作效率
- 无需逐个点击和复制

### 3. 复制事件传播修复

**问题背景**: 
- 用户点击修正结果中的英文框，期望复制框内内容
- 实际现象：点击无反应
- 根本原因：点击事件冒泡到父级卡片的 onClick 处理器，导致组件重新渲染，破坏了复制状态

**解决方案**: 在 `CopyableText` 组件的 `handleCopy()` 函数中添加 `e.stopPropagation()`

**实现位置**: `src/App.tsx` - `CopyableText` 组件

**代码**:
```javascript
const handleCopy = (e: React.MouseEvent) => {
  e.stopPropagation(); // 阻止事件冒泡到父级元素
  navigator.clipboard.writeText(text);
  setCopyState(true);
  setTimeout(() => setCopyState(false), 2000);
};
```

**事件流演变**:
```
用户点击 CopyableText
  ↓
handleCopy() 被触发
  ↓
e.stopPropagation() 阻止冒泡
  ↓
复制成功，显示反馈
  ✓（之前会冒泡到卡片 onClick，导致失败）
```

### 4. 审计过滤逻辑修复

**问题背景**:
- 用户反馈："点击'开始质检'按钮，没有进度条，也没有结果"
- 审计功能完全不工作

**根本原因分析**:
- 原始过滤条件：`batchItems.filter(item => !item.chinese)`
- 问题：该过滤条件排除了**所有包含中文的段落**
- 实际情况：所有输入都是**中英文对照**（都既有中文又有英文）
- 结果：被过滤后的列表为空，没有内容可审计

**解决方案**: 修改过滤条件为明确的正向检查

**实现位置**: `src/App.tsx` - `handleAuditClick()` 函数

**修复代码**:
```javascript
// 修复前
const itemsToAudit = batchItems.filter(item => !item.chinese);

// 修复后：只审计有英文内容的段落
const itemsToAudit = batchItems.filter(item => item.english && item.english.trim().length > 0);
```

**逻辑改进**:
- 从**排除法**改为**检查法**
- 明确检查英文内容是否存在且非空
- 符合实际的输入格式（中英对照）

### 5. AI 标记高亮规则优化

**问题背景**:
- AI 将已经正确的词汇（如 He、His、Your）标记为**绿色添加**（用 `**word**` 包裹）
- 用户反馈："这些并不是错误"

**根本原因**:
- AI 没有区分"原文就正确的词"和"修正后的词"
- 可能的情况：某些词在原文中已经是正确的，不需要修改

**解决方案**: 更新 AI 审计提示词，添加明确的规则

**实现位置**: `src/App.tsx` - AI 审计提示词（system prompt）

**新增规则**:
```
只标记【实际发生了改变】的词。如果原文某个词已经是正确的
（例如 He、His、Your 已经大写），则不要用任何标记包裹它。
```

**提示词改进逻辑**:
1. AI 对比原文和修正文
2. 识别实际改变的词汇
3. 只标记改变的部分
4. 已正确的词汇不加任何标记

**标记类型**:
- `**word**` = 绿色添加（新增的词或修改后的词）
- `~~word~~` = 红色删除（移除的词或修改前的词）
- 无标记 = 原文就正确，保持不变

---

## 输入输出格式

### 支持的输入格式

**1. 内联格式**（原有格式）
```
1. 中文文案 English text
2. 另一条 Another one
```

**2. TSV 格式**（新增）
```
序号	中文	英文
1	"中文文案"	"English text"
2	"另一条"	"Another one"
```

支持带引号的多行字段：
```
1	"中文
  跨行"	"English
  multi-line"
```

### 输出格式

审计结果为结构化对象数组：
```javascript
{
  chinese: "中文文案",
  english: "English text",
  corrected: "English Text",  // 修正后的版本
  highlights: {
    original: "English ~~text~~",      // 删除部分用 ~~~~
    corrected: "English **Text**"      // 新增部分用 ****
  }
}
```

---

## 状态管理

### 关键状态变量

| 状态 | 类型 | 用途 |
|------|------|------|
| `input` | string | 用户输入的文案 |
| `batchItems` | Array | 解析后的中英文对 |
| `auditResults` | Array | 审计后的结果 |
| `isAuditing` | boolean | 审计进行中标志 |
| `selectedResults` | Set | 多选框选中的结果 |
| `copyState` | boolean | 复制按钮反馈状态 |

### 数据流

```
用户输入
  ↓
格式检测 (TSV or 内联)
  ↓
解析为 batchItems
  ↓
点击"开始质检"
  ↓
过滤有英文的项
  ↓
调用 AI 审计 API
  ↓
接收审计结果
  ↓
渲染 auditResults
  ↓
用户复制/全选
```

---

## API 集成

### 后端审计 API

**端点**: `POST /api/audit-batch`

**请求**:
```javascript
{
  items: [
    { chinese: "中文", english: "English" },
    ...
  ]
}
```

**响应**:
```javascript
{
  results: [
    {
      chinese: "中文",
      english: "English",
      corrected: "English",
      highlights: {...}
    },
    ...
  ]
}
```

### AI 模型配置

**主模型**: `gemini-2.5-flash-lite`
**备用模型**: `gemini-2.5-flash`

故障转移逻辑：主模型失败时自动切换到备用模型

---

## 性能优化

1. **事件处理优化**: 使用 `e.stopPropagation()` 防止不必要的重新渲染
2. **格式检测缓存**: 一次检测结果缓存，避免重复检测
3. **批量处理**: 同时审计多个文案项，提高 API 利用率
4. **增量更新**: 只重新渲染改变的结果项

---

## 已知限制和改进空间

1. **多行字段处理**: TSV 格式的多行引号字段可能在某些特殊情况下失败
2. **API 超时**: 大批量文案可能超时，建议分批处理
3. **模型准确度**: 某些专业术语可能被修正不当

---

## 开发指南

### 添加新功能时的检查清单

- [ ] 更新此文档中的相关章节
- [ ] 添加代码注释说明关键逻辑
- [ ] 测试事件传播（如有 DOM 操作）
- [ ] 验证状态管理流程
- [ ] 在 CLAUDE.md 中记录工作流程规则（如适用）

### 常见调试

**审计不工作**:
1. 检查 `batchItems` 是否为空
2. 确认过滤条件是否正确
3. 查看 API 响应是否有错误

**复制无反应**:
1. 检查 `e.stopPropagation()` 是否存在
2. 验证 `navigator.clipboard` API 是否可用
3. 查看浏览器控制台是否有错误

**格式解析错误**:
1. 检查输入是否为正确的 TSV 或内联格式
2. 验证正则表达式是否匹配
3. 测试 `stripQuotes()` 函数的输出
