---
title: "Hello LLM — 用 TypeScript 调用大模型"
description: "30 行 TypeScript 代码调用 Anthropic Claude / OpenAI GPT API 并获取回复"
---

# 第 01 章：Hello LLM — 30 行代码调用大模型

> 怎样用代码调用一次 LLM，拿到它的回复？这是构建 Agent 的第一步。

## 这一章要做什么？

上一章我们看到了 Agent 的完整运行过程，但那只是观察。这一章开始动手写一个最小的程序，给模型发一句话，等它回一句话。不涉及工具、不涉及循环、不涉及流式输出。就是最纯粹的一次 LLM 调用。

完成后你会得到一个能运行的 30 行脚本，也会理解 LLM 调用的本质：**发送 Context，接收 AssistantMessage**。

---

## LLM 调用的本质是什么？

不管你用 Anthropic、OpenAI 还是其他厂商的 API，一次 LLM 调用归结为一件事：

```
输入：Context = { systemPrompt, messages, tools }
输出：AssistantMessage = { content, stopReason, usage, ... }
```

Context 是模型看到的全部信息。模型读完 Context，生成一条 AssistantMessage 作为回复。这就是全部了。

注意 `tools` 字段——这一章我们不传工具，所以模型只能用文本回答。到第 06 章加上工具后，模型才能"动手"。

---

## 代码实现

我们用 `pi-ai` 这个库来调用模型。它提供了 30 多个厂商的统一接口，一套代码就能切换 Anthropic、OpenAI 等不同 provider。

### 安装依赖

```bash
npm install @earendil-works/pi-ai
```

### 完整代码：hello-llm.ts

```typescript
/**
 * Hello LLM — 最简单的一次模型调用
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx hello-llm.ts
 *   # 或
 *   OPENAI_API_KEY=sk-... npx tsx hello-llm.ts
 */

import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context } from "@earendil-works/pi-ai";

// 1. 初始化 models 容器（注册所有内置 provider）
const models = builtinModels();

// 2. 选择一个模型
const model = getBuiltinModel("anthropic", "claude-sonnet-4-20250514");

// 3. 构建 Context — 模型看到的全部输入
const context: Context = {
  systemPrompt: "You are a helpful assistant. Reply in Chinese.",
  messages: [
    { role: "user", content: "用一句话解释什么是 Agent Loop", timestamp: Date.now() }
  ],
  // tools 不传 — 模型只能用文本回答
};

// 4. 调用模型，等待完整回复
const response = await models.completeSimple(model, context);

// 5. 打印结果
console.log(response.content[0].type === "text" ? response.content[0].text : "(non-text)");
console.log(`\n[model: ${response.model}, tokens: ${response.usage.input}+${response.usage.output}]`);
```

### 运行

```bash
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx hello-llm.ts
```

你会看到类似这样的输出：

```
Agent Loop 是程序反复调用模型、执行工具、把结果传回模型的循环过程，直到模型认为任务完成为止。

[model: claude-sonnet-4-20250514, tokens: 38+42]
```

---

## 代码拆解：每一步在做什么？

### `builtinModels()` — 创建 Models 容器

```typescript
const models = builtinModels();
```

这一行做了两件事：
- 调用 `createModels()` 创建一个空的 Models 容器
- 注册所有内置 provider（Anthropic、OpenAI、DeepSeek、Google 等 30 多个）

容器创建好后，认证信息通过环境变量自动解析——你设了 `ANTHROPIC_API_KEY`，Anthropic 的 provider 就能工作。

### `getBuiltinModel()` — 获取模型定义

```typescript
const model = getBuiltinModel("anthropic", "claude-sonnet-4-20250514");
```

从内置目录中查找模型定义。返回的 `Model` 对象包含模型的 ID、provider、API 格式、上下文窗口大小等元数据。模型对象本身不包含执行逻辑，它只是一个描述。

### `Context` — 模型的输入

```typescript
const context: Context = {
  systemPrompt: "...",
  messages: [...],
  // tools: [...]  ← 这一章不传
};
```

Context 的结构在第 00 章已经见过了。三个字段：
- `systemPrompt`：可选，告诉模型"你是谁、你该怎么做"
- `messages`：对话历史，至少要有一条 user 消息
- `tools`：可选，告诉模型有哪些工具可以用

这一章只用前两个。

### `completeSimple()` — 发起调用

```typescript
const response = await models.completeSimple(model, context);
```

把 Context 发给模型，等模型生成完毕后返回完整的 `AssistantMessage`。整个过程是阻塞的——要等到模型把所有 token 都生成完才能拿到结果。

返回的 `response` 包含：
- `content`：内容块数组（这一章只会有一个 text 块）
- `stopReason`：模型停止的原因（`"end_turn"` 表示正常结束）
- `usage`：token 用量统计
- `model`：实际使用的模型 ID

---

## 如果想用 OpenAI 呢？

换一行代码就行：

```typescript
const model = getBuiltinModel("openai", "gpt-4o");
```

运行时把环境变量换成 `OPENAI_API_KEY`。`models.completeSimple()` 的调用方式完全不变——这就是统一接口的好处。第 04 章会详细讲多模型适配的原理。

---

## completeSimple 和 streamSimple 的区别？

| 方法 | 行为 | 适合场景 |
|------|------|---------|
| `completeSimple()` | 等全部生成完再返回 | 脚本、测试、不需要实时显示 |
| `streamSimple()` | 返回事件流，逐 token 到达 | CLI 交互、需要实时显示给用户 |

这一章用 `completeSimple()` 是因为简单。但如果模型回复很长，用户要干等 10 秒才能看到内容，体验不好。下一章我们就切换到 `streamSimple()`，实现逐字显示。

---

## 小结

一次 LLM 调用的本质：构建 Context（systemPrompt + messages），调用 `completeSimple()` 发给模型，模型返回一个 AssistantMessage。30 行代码就能跑起来。

但这 30 行有一个体验问题——要等模型全部生成完才能看到输出。对于短回答还好，长回答就让人焦虑了。

---

## 下一章

下一章解决这个等待问题。`streamSimple()` 返回的不是一个完整消息，而是一个事件流——模型每生成一个 token，你就能立刻收到并显示。我们来看看这个流是怎么工作的。

→ [第 02 章：EventStream 事件流 — 流式输出的秘密](./02-event-stream.md)
