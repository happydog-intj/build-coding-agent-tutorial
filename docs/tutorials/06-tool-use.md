---
title: "Tool Use — 让 LLM 调用函数"
description: "实现 LLM 工具调用协议：JSON Schema 声明工具、tool_call 请求、tool_result 配对返回"
---

# 第 06 章：Tool Use 工具调用 — 让 LLM 调用函数

> LLM 只能生成文本，怎样让它"做事"？

## 这一章要解决什么问题？

前几章模型只能用文字回答问题。但 Coding Agent 需要读文件、写文件、执行命令。模型自己做不了这些 — 它只是一个文本生成器。

解法是"工具调用"协议：程序告诉模型"你有这些工具可以用"，模型想用某个工具时返回一个 toolCall 指令，程序执行工具后把结果传回模型。模型全程不碰文件系统或网络 — 它只是表达意图，程序负责执行。

---

## Tool 的定义是什么？

一个 Tool 就是一段 JSON Schema 声明：名字、描述、参数结构。

```typescript
interface Tool {
  name: string;           // 工具名（模型引用时用这个名字）
  description: string;    // 告诉模型这个工具干什么、什么时候该用
  parameters: object;     // JSON Schema — 定义参数的类型和约束
}
```

Tool 是纯声明，不包含执行逻辑。模型看到的是 schema，程序持有 execute 函数。

在我们的项目中，用 `MiniTool` 把声明和执行放在一起：

```typescript
interface MiniTool {
  name: string;
  description: string;
  parameters: object;                                    // JSON Schema
  execute: (params: Record<string, any>) => Promise<ToolResult>;  // 执行逻辑
}
```

传给模型时只取前三个字段（schema），`execute` 留在程序这边。

---

## 工具调用的完整流程

让我们用一个 `get_current_time` 工具走一遍完整流程：

### 第 1 步：定义工具

```typescript
const getTimeTool: MiniTool = {
  name: "get_current_time",
  description: "Get the current date and time in ISO format",
  parameters: {
    type: "object",
    properties: {},  // 不需要参数
  },
  async execute() {
    return { content: new Date().toISOString() };
  },
};
```

### 第 2 步：把工具 schema 传给模型

```typescript
const context: Context = {
  systemPrompt: "You are a helpful assistant.",
  messages: [
    { role: "user", content: "现在几点了？", timestamp: Date.now() }
  ],
  tools: [
    { name: "get_current_time", description: "Get current time in ISO format", parameters: { type: "object", properties: {} } }
  ],
};
```

模型看到 `tools` 列表后知道自己可以用 `get_current_time`。

### 第 3 步：模型返回 toolCall

模型分析用户的问题"现在几点了？"，决定调用 `get_current_time` 工具：

```typescript
// 模型返回的 AssistantMessage
{
  role: "assistant",
  content: [
    { type: "toolCall", id: "tc_001", name: "get_current_time", arguments: {} }
  ],
  stopReason: "toolUse"  // 模型主动停下来，等待工具结果
}
```

注意 `stopReason` 是 `"toolUse"` — 模型不是说完了，是在等结果。

### 第 4 步：程序执行工具

```typescript
const tool = tools.find(t => t.name === "get_current_time");
const result = await tool.execute({});
// result = { content: "2024-06-15T14:30:22.000Z" }
```

### 第 5 步：构造 toolResult 传回模型

```typescript
const toolResultMsg: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "tc_001",       // ← 必须与 toolCall.id 配对！
  toolName: "get_current_time",
  content: [{ type: "text", text: "2024-06-15T14:30:22.000Z" }],
  isError: false,
  timestamp: Date.now(),
};
```

### 第 6 步：再次调用模型

把 toolResult 追加到 messages 后再次调用模型：

```typescript
messages = [
  { role: "user", content: "现在几点了？" },
  { role: "assistant", content: [toolCall: get_current_time()] },
  { role: "toolResult", toolCallId: "tc_001", content: "2024-06-15T14:30:22.000Z" },
];
```

模型看到时间结果后，生成人类可读的回复：

```typescript
{
  role: "assistant",
  content: [{ type: "text", text: "现在是下午 2:30（2024年6月15日）。" }],
  stopReason: "stop"  // 正常结束，不再需要工具
}
```

---

## 完整的消息时序

整理一下六条消息的因果链：

```
messages[0]: user("现在几点了？")
    ↓ 发给 LLM（Context 带上 tools schema）
messages[1]: assistant([toolCall: {id:"tc_001", name:"get_current_time"}])
    ↓ 程序看到 toolCall，执行 get_current_time()
messages[2]: toolResult({toolCallId:"tc_001", content:"2024-06-15T14:30:22.000Z"})
    ↓ 再次发给 LLM（messages[0..2] 全部传过去）
messages[3]: assistant([text: "现在是下午 2:30"])
```

四条消息、两次 LLM 调用、一次工具执行。

---

## toolCallId 配对：不能漏、不能错

这是贯穿整个教程的不变量。让我们严肃看一下为什么这个配对这么重要。

模型一次可能返回多个 toolCall：

```typescript
// 模型决定同时调两个工具
{
  content: [
    { type: "toolCall", id: "tc_001", name: "read_file", arguments: { path: "a.ts" } },
    { type: "toolCall", id: "tc_002", name: "read_file", arguments: { path: "b.ts" } },
  ]
}
```

程序必须为每个 toolCall 生成一个配对的 toolResult：

```typescript
messages.push({ role: "toolResult", toolCallId: "tc_001", ... });
messages.push({ role: "toolResult", toolCallId: "tc_002", ... });
```

如果漏掉 `tc_002` 的结果，模型下一轮看到的历史是：
- 我请求了两个工具调用
- 只收到了一个结果
- 另一个去哪了？

有些 API（比如 Anthropic）会直接拒绝这种不完整的请求。即使不报错，模型的行为也会变得不可预测。

---

## description 的重要性

模型根据工具的 `description` 决定要不要用这个工具。description 写得好，模型用得准；写得模糊，模型要么不用要么乱用。

对比：

```typescript
// ✗ 模糊的 description — 模型不确定什么时候该用
{ name: "bash", description: "Run a command" }

// ✓ 清晰的 description — 模型知道用途和限制
{ name: "bash", description: "Execute a shell command and return stdout+stderr. Use for running tests, git, package managers. Times out after 30s." }
```

description 是你跟模型沟通的接口。把它当作给同事写的 API 文档 — 说清楚干什么、什么时候用、有什么限制。

---

## 手动完成一次完整的 tool use

把上面的流程串成一段可运行的代码：

```typescript
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message, Tool } from "@earendil-works/pi-ai";

const models = builtinModels();
const model = getBuiltinModel("anthropic", "claude-sonnet-4-20250514");

// 工具 schema（传给模型看的）
const tools: Tool[] = [{
  name: "get_current_time",
  description: "Get the current date and time in ISO format",
  parameters: { type: "object", properties: {} } as any,
}];

// 第 1 次调用
const messages: Message[] = [
  { role: "user", content: "现在几点了？", timestamp: Date.now() }
];

const stream1 = models.streamSimple(model, { systemPrompt: "Reply in Chinese.", messages, tools });
for await (const e of stream1) { /* 消费流 */ }
const reply1 = await stream1.result();
messages.push(reply1);

// 检查是否有 toolCall
const toolCalls = reply1.content.filter(c => c.type === "toolCall");
if (toolCalls.length > 0) {
  // 执行工具
  for (const tc of toolCalls) {
    const result = new Date().toISOString(); // 实际执行
    messages.push({
      role: "toolResult",
      toolCallId: tc.id,
      toolName: tc.name,
      content: [{ type: "text", text: result }],
      isError: false,
      timestamp: Date.now(),
    });
  }

  // 第 2 次调用（带工具结果）
  const stream2 = models.streamSimple(model, { systemPrompt: "Reply in Chinese.", messages, tools });
  for await (const e of stream2) {
    if (e.type === "text_delta") process.stdout.write(e.delta);
  }
  const reply2 = await stream2.result();
  messages.push(reply2);
}
```

这段代码手动处理了一次 tool use 的完整流程。但如果模型需要调用两次、三次工具呢？你总不能无限 if/else 下去。下一章用一个 while 循环解决这个问题。

---

## 小结

Tool Use 让 LLM 从"只能说话"变成"能做事"。Tool 是纯 JSON Schema 声明（告诉模型有什么工具可以用），模型想用工具时返回 toolCall（表达意图），程序执行后构造 toolResult 传回（告知结果）。toolCallId 配对是协议不变量 — 每个 toolCall 必须有且只有一个对应的 toolResult。模型根据 description 决定何时使用工具，所以 description 要写得清楚具体。

---

## 下一章

这一章手动完成了一次工具调用。但现实任务往往需要连续调多次工具。下一章把这个"调用模型 → 有 toolCall？→ 执行 → 再来"的过程包进一个 while 循环 — 这就是 Agent Loop。

→ [第 07 章：Agent Loop — 从一次调用到自主循环](./07-agent-loop.md)
