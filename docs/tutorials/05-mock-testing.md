---
title: "模拟测试 — 不花钱验证 Agent 逻辑"
description: "用 ScriptedModel 预设响应做确定性测试，零 API 费用验证 Agent Loop 行为"
---

# 第 05 章：模拟测试 — 不花钱验证 Agent 逻辑

> 每次测试都要调真实 API？太慢、太贵、还不可复现。怎样脱离真模型验证 Agent 的逻辑？

## 这一章要解决什么问题？

到目前为止，每次验证 Agent 行为都要发真实的 API 请求。这有三个问题：

1. **慢** — 一次调用要等 3-10 秒，测五种场景就是一分钟
2. **贵** — 每次测试都烧 token，日积月累是真金白银
3. **不可复现** — 同一个 prompt 每次回复都不一样，测试结果不稳定

这一章引入"录播模型"：预先设定好模型的响应序列，替换掉真实的 API 调用。Agent Loop 跑起来跟用真模型一模一样，但响应是你控制的、确定性的、免费的。

---

## 为什么能这样做？

回忆一下 AgentConfig 的 `streamFn`：

```typescript
interface AgentConfig {
  streamFn: (model: Model<any>, context: Context) => AssistantMessageEventStream;
  // ...
}
```

Agent Loop 不直接调用 API，它只调用 `streamFn`。只要这个函数返回一个 `AssistantMessageEventStream`，Agent Loop 不关心数据来自真实 API 还是本地预设。这个其实就是软件工程里最重要的一条：依赖接口编程。

这就是协议边界带来的可测试性 — 只要实现相同的接口，替换实现对调用方透明。

---

## 录播模型的概念

想象一台录像机。你提前录好两段视频（两个预设响应），按播放键后它们按顺序播出：

```
第 1 次调用 streamFn → 播放第 1 个预设响应
第 2 次调用 streamFn → 播放第 2 个预设响应
第 3 次调用 streamFn → 没有更多预设了，报错
```

像放录像带一样。游标从第一个开始，每次调用推进一格。

---

## 实现 createScriptedModel

```typescript
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
} from "@earendil-works/pi-ai";
import { AssistantMessageEventStream as EventStreamClass } from "@earendil-works/pi-ai";

interface ScriptedModel {
  /** 已经被调用了多少次 */
  callCount: number;
  /** 每次调用收到的 Context 快照 */
  calls: Context[];
  /** 消费下一个预设响应，返回流 */
  next(ctx: Context): AssistantMessageEventStream;
}

function createScriptedModel(responses: AssistantMessage[]): ScriptedModel {
  let cursor = 0;
  const calls: Context[] = [];

  return {
    get callCount() { return calls.length; },
    get calls() { return calls; },

    next(ctx: Context): AssistantMessageEventStream {
      // 记录这次调用收到的 Context（用于事后断言）
      calls.push(ctx);

      if (cursor >= responses.length) {
        throw new Error(
          `ScriptedModel: no more responses (called ${cursor + 1} times, only ${responses.length} responses)`
        );
      }

      const response = responses[cursor++];

      // 将完整的 AssistantMessage 投影为一组流式事件
      const stream = new EventStreamClass();

      // 异步推送事件（模拟流式到达）
      queueMicrotask(() => {
        for (const block of response.content) {
          if (block.type === "text") {
            stream.push({ type: "text_delta", delta: block.text, partial: response });
          }
          // toolCall 块也可以投影为 toolcall_start + toolcall_end
        }
        stream.end(response);
      });

      return stream;
    },
  };
}
```

三个关键点：

1. **游标推进**：每次 `next()` 调用消费一个预设，cursor 加 1
2. **请求快照**：把收到的 Context 存入 `calls` 数组，测试结束后可以断言"Agent 第二次调用模型时传了什么"
3. **消息投影**：把完整的 AssistantMessage 拆成流式事件推入 stream，然后 end

---

## 消息到事件的投影

真实 API 是逐 token 推送的。录播模型为了简单，把整个文本块作为一个 `text_delta` 推送。对 Agent Loop 来说没有区别 — 它只关心遍历完流之后 `stream.result()` 返回的完整消息。

如果你想模拟逐字到达的效果（比如测试 UI 的流式渲染），可以把文本拆成多个 delta：

```typescript
// 逐字投影
for (const char of block.text) {
  stream.push({ type: "text_delta", delta: char, partial: response });
}
```

但对于测试 Agent 逻辑，一次性推完就够了。

---

## 完整测试用例

看一个完整的测试场景 — 验证 Agent 能完成"读取文件并总结"的任务：

```typescript
import { runAgent, type AgentConfig, type MiniTool } from "./agent-loop";

// 准备一个假的 read_file 工具
const fakeReadFile: MiniTool = {
  name: "read_file",
  description: "Read file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async execute(params) {
    return { content: "# Hello\n\nThis is a test file with 3 lines." };
  },
};

// 预设两轮响应
const scripted = createScriptedModel([
  // 第 1 轮：模型决定调用 read_file
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "README.md" } }],
    stopReason: "toolUse",
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    model: "scripted", api: "anthropic-messages", provider: "anthropic", timestamp: Date.now(),
  },
  // 第 2 轮：模型看到文件内容后给出总结
  {
    role: "assistant",
    content: [{ type: "text", text: "这个文件有 3 行，是一个简单的测试文件。" }],
    stopReason: "stop",
    usage: { input: 150, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 180, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    model: "scripted", api: "anthropic-messages", provider: "anthropic", timestamp: Date.now(),
  },
]);

// 配置 Agent 使用录播模型
const config: AgentConfig = {
  model: { id: "scripted" } as any,
  streamFn: (_model, ctx) => scripted.next(ctx),
  tools: [fakeReadFile],
  systemPrompt: "You are a helpful assistant.",
};

// 运行 Agent
const messages = await runAgent("总结 README.md", [], config);

// ═══ 断言 ═══

// 模型被调用了 2 次
console.assert(scripted.callCount === 2, "Should call model twice");

// 第 2 次调用的 messages 中包含 toolResult
const secondCall = scripted.calls[1];
const hasToolResult = secondCall.messages.some(m => m.role === "toolResult");
console.assert(hasToolResult, "Second call should include toolResult");

// 最终消息是文本回复
const lastMsg = messages[messages.length - 1];
console.assert(lastMsg.role === "assistant", "Last message should be assistant");

console.log("All assertions passed!");
```

---

## 请求快照的用途

`scripted.calls` 数组记录了每次调用模型时 Agent 传入的完整 Context。你可以用它断言：

- Agent 第一次调用时传了几条 messages？（应该只有 1 条 user message）
- Agent 第二次调用时传的 messages 里有没有 toolResult？（必须有）
- toolResult 的内容是不是工具实际返回的？
- systemPrompt 对不对？

这比"看最终输出是否正确"更精确 — 你在验证 Agent 的行为过程，而不只是最终结果。

---

## 小结

录播模型把"依赖真实 API"的测试变成了确定性的本地验证。核心技巧是替换 `streamFn` — Agent Loop 只认接口，不认实现。`createScriptedModel` 预设一组响应按顺序播放，同时快照每次收到的 Context 用于事后断言。这让你能验证 Agent 的完整行为路径：调用了几次模型、每次传了什么、工具结果有没有正确回传。

---

## 下一章

到这里我们有了统一接口、有了测试手段，但模型只能说话不能做事。下一章让模型"动手" — 看工具调用的完整协议：模型返回 toolCall，程序执行工具，结果通过 toolResult 传回。

→ [第 06 章：Tool Use — 让 LLM 调用函数](./06-tool-use.md)
