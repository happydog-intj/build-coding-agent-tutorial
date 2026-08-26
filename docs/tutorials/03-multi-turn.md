---
title: "多轮对话 — 消息协议与上下文记忆"
description: "实现 LLM 多轮对话：messages 数组累积、角色区分、上下文传递机制"
---

# 第 03 章：多轮对话 — 消息协议与记忆

> 模型为什么不记得我上一句说了什么？多轮对话到底是怎么实现的？

## 这一章要解决什么问题？

上两章我们调用了模型，也实现了流式输出，但每次都是"一问一答"就结束了。如果你想接着问"能展开说说第二点吗？"，模型会一脸茫然 — 它不知道你之前问了什么。

这一章来搞清楚多轮对话的实现机制：LLM 没有记忆，所谓"记住上下文"是程序每次把完整对话历史传给模型。消息列表（messages）就是模型的"记忆"。

---

## LLM 为什么"没有记忆"？

每次调用 LLM 都是独立的。模型不会自己记住上一轮的对话。看一下这个对比：

```
第 1 次调用：
  Context = { messages: [user("TypeScript 有哪些基础类型？")] }
  → 模型回答了基础类型列表

第 2 次调用（不带历史）：
  Context = { messages: [user("能展开说说第二点吗？")] }
  → 模型困惑：什么第二点？

第 2 次调用（带历史）：
  Context = { messages: [
    user("TypeScript 有哪些基础类型？"),
    assistant("1. string 2. number 3. boolean ..."),
    user("能展开说说第二点吗？")
  ] }
  → 模型知道"第二点"是 number，展开解释
```

秘密就在 messages 数组里。程序每次调用模型时，把之前所有的对话消息都传过去。模型读完整个 messages，才知道当前对话走到了哪一步。

---

## 三种消息角色

messages 数组里有三种消息，用 `role` 字段区分：

### UserMessage — 用户说的话

```typescript
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}
```

最常见的形式就是一个字符串。`content` 也可以是数组，用于传图片（多模态），但大多数场景下就是纯文本。

### AssistantMessage — 模型的回复

```typescript
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  stopReason: StopReason;
  usage: Usage;
  model: string;
  timestamp: number;
}
```

注意 `content` 是一个数组 — 一条 assistant 消息可以同时包含多个内容块。比如模型可能先输出一段文字，然后决定调用一个工具，那 content 里就有一个 TextContent 和一个 ToolCall。

### ToolResultMessage — 工具执行结果

```typescript
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;   // 必须与 toolCall.id 配对
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}
```

这个消息由程序生成，不是模型生成的。每个 toolResult 必须通过 `toolCallId` 跟对应的 toolCall 配对。

---

## 统一的 Message 类型

三种消息用联合类型表示：

```typescript
type Message = UserMessage | AssistantMessage | ToolResultMessage;
```

TypeScript 的 discriminated union 让你可以通过 `role` 字段收窄类型：

```typescript
function processMessage(msg: Message) {
  switch (msg.role) {
    case "user":
      // TypeScript 知道 msg 是 UserMessage
      console.log(msg.content);
      break;
    case "assistant":
      // TypeScript 知道 msg 是 AssistantMessage
      console.log(msg.stopReason);
      break;
    case "toolResult":
      // TypeScript 知道 msg 是 ToolResultMessage
      console.log(msg.toolCallId);
      break;
  }
}
```

---

## content 为什么是数组？

你可能觉得奇怪：为什么 AssistantMessage 的 content 不直接是一个字符串？

因为模型一次回复可能包含多种内容。最典型的场景是工具调用 — 模型可能先说一句话，然后调用工具：

```typescript
// 一条 assistant 消息，content 里有两个块
{
  role: "assistant",
  content: [
    { type: "text", text: "让我先看看这个文件的内容。" },
    { type: "toolCall", id: "tc_001", name: "read_file", arguments: { path: "app.ts" } }
  ],
  stopReason: "toolUse"
}
```

或者模型只回答文本（没有工具调用）：

```typescript
{
  role: "assistant",
  content: [
    { type: "text", text: "这是一个用 TypeScript 写的 web 服务器。" }
  ],
  stopReason: "stop"
}
```

content 是数组，让同一条消息能承载不同类型的内容块，不需要为"纯文本回复"和"工具调用回复"设计两种不同的消息结构。

---

## toolCallId 配对的不变量

这是贯穿整个教程的核心规则：**每个 toolCall.id 有且只有一个对应的 toolResult.toolCallId**。

```
assistant.content 里有一个 toolCall，id = "tc_001"
    ↓
messages 里必须有一个 toolResult，toolCallId = "tc_001"
```

漏掉一个 toolResult 会怎样？模型下一轮调用时看到"我请求了一个工具调用，但没有收到结果"，会产生困惑。有些 API 甚至会直接报错拒绝请求。

记住这个规则，后续实现 Agent Loop 时会反复用到。

---

## 实践：多轮对话 CLI

让我们用 readline 实现一个多轮对话程序，看看 messages 是怎样一轮一轮累积的：

```typescript
/**
 * 多轮对话 — 演示 messages 的累积
 *
 * 运行：ANTHROPIC_API_KEY=sk-ant-... npx tsx multi-turn.ts
 */

import * as readline from "node:readline";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message } from "@earendil-works/pi-ai";

const models = builtinModels();
const model = getBuiltinModel("anthropic", "claude-sonnet-4-20250514");

// messages 数组 — 这就是模型的"记忆"
const messages: Message[] = [];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

console.log("多轮对话（输入 /quit 退出）\n");

while (true) {
  const input = await question("> ");
  if (input.trim() === "/quit") break;
  if (!input.trim()) continue;

  // 1. 用户消息加入列表
  messages.push({ role: "user", content: input, timestamp: Date.now() });

  // 2. 构建 Context — 每次都传完整的 messages
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Reply in Chinese.",
    messages,  // ← 完整历史！
  };

  // 3. 调用模型
  const stream = models.streamSimple(model, context);
  for await (const event of stream) {
    if (event.type === "text_delta") {
      process.stdout.write(event.delta);
    }
  }
  console.log("\n");

  // 4. 模型回复加入列表
  const reply = await stream.result();
  messages.push(reply);

  // 此时 messages 包含了完整的对话历史
  // 下一轮循环，模型能看到所有之前的对话
}

rl.close();
```

---

## messages 累积的过程

运行这个程序，对话三轮后 messages 长这样：

```
messages[0]: { role: "user",      content: "TypeScript 有哪些基础类型？" }
messages[1]: { role: "assistant", content: [{type:"text", text:"1. string..."}] }
messages[2]: { role: "user",      content: "展开说说 number" }
messages[3]: { role: "assistant", content: [{type:"text", text:"number 表示..."}] }
messages[4]: { role: "user",      content: "它和 bigint 有什么区别？" }
messages[5]: { role: "assistant", content: [{type:"text", text:"number 是 64 位浮点..."}] }
```

第三轮调用模型时，Context.messages 包含 messages[0] 到 messages[4]。模型读完所有五条消息，才知道"它"指的是 number、对话主题是 TypeScript 的数字类型。

每一轮对话都让 messages 变长。这也是为什么后面需要"上下文窗口管理"（第 12 章）— messages 不能无限增长，模型的上下文窗口有大小限制。

---

## 小结

LLM 没有记忆，多轮对话靠程序维护一个 messages 数组实现。每次调用模型时传入完整的 messages，模型就能"记住"之前说过什么。messages 里有三种角色的消息：user（用户输入）、assistant（模型回复，content 是数组，可包含文本和 toolCall）、toolResult（程序执行工具后的结果，必须通过 toolCallId 配对）。这套协议是 Agent 通信的基础，后续所有章节都建立在这个消息累积机制之上。

---

## 下一章

现在我们的代码写死了 Anthropic 的模型。如果想换成 OpenAI 呢？两家的 API 格式完全不同 — 消息结构不同、请求格式不同、流式协议不同。下一章看 pi-ai 怎样用一个适配层屏蔽这些差异。

→ [第 04 章：多模型适配 — 一套代码切换不同厂商](./04-multi-model-adapter.md)
