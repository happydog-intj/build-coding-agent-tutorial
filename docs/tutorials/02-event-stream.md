# 第 02 章：EventStream 事件流 — 流式输出的秘密

> 等 10 秒才看到回复太痛苦了，怎样让模型的回答逐字显示出来？

## 这一章要解决什么问题？

上一章用 `completeSimple()` 调用模型，必须等全部 token 生成完才能看到结果。如果模型回复 500 个 token，你得干等 5-10 秒看着空白屏幕。

这一章切换到 `streamSimple()`，模型每生成一个 token 你就能立刻收到并显示。用户体验从"等完再看"变成"边生成边看"，跟 ChatGPT 的打字机效果一样。

---

## 流式和非流式的区别在哪？

对比一下两种方式：

```
completeSimple():
  程序 ──请求──→ 模型
  程序 ←─────── 模型（10秒后，一次性返回全部内容）

streamSimple():
  程序 ──请求──→ 模型
  程序 ←─ token ─ 模型（立即开始，一个接一个到达）
  程序 ←─ token ─ 模型
  程序 ←─ token ─ 模型
  ...
  程序 ←─ done ── 模型（结束信号）
```

`streamSimple()` 返回的不是 AssistantMessage，而是一个 `AssistantMessageEventStream` —— 一个 async iterable，你用 `for await` 就能逐个消费事件。

---

## 代码实现

### 完整代码：stream-llm.ts

```typescript
/**
 * Stream LLM — 流式输出，逐 token 显示
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx stream-llm.ts
 */

import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context } from "@earendil-works/pi-ai";

const models = builtinModels();
const model = getBuiltinModel("anthropic", "claude-sonnet-4-20250514");

const context: Context = {
  systemPrompt: "You are a helpful assistant. Reply in Chinese.",
  messages: [
    { role: "user", content: "用三句话解释 TypeScript 的类型系统", timestamp: Date.now() }
  ],
};

// streamSimple 返回一个 AssistantMessageEventStream
const stream = models.streamSimple(model, context);

// 用 for await 逐个消费事件
for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);  // 逐 token 写到终端，不换行
  }
}

// 流结束后，取出完整的 AssistantMessage
const message = await stream.result();
console.log(`\n\n[tokens: ${message.usage.input}+${message.usage.output}]`);
```

### 运行效果

```bash
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx stream-llm.ts
```

你会看到文字一个个蹦出来，而不是等一堆再显示：

```
Type|Script| 的|类型|系统|是| JavaScript| 的|超集|...
```

每个 `|` 代表一次 `text_delta` 事件到达的时刻。实际运行时你看不到分隔符，只看到文字在终端上逐渐出现。

---

## AssistantMessageEventStream 是什么？

`streamSimple()` 返回的 `AssistantMessageEventStream` 有两个身份：

1. **async iterable** — 你可以 `for await` 遍历它，逐个拿到事件
2. **result 持有者** — 流结束后调用 `stream.result()` 拿到完整的 `AssistantMessage`

```typescript
const stream = models.streamSimple(model, context);

// 身份 1：逐个消费事件
for await (const event of stream) {
  // 处理每个事件...
}

// 身份 2：流结束后取完整结果
const finalMessage = await stream.result();
```

这个设计的好处是：你既能实时处理流中的每个片段，又能在最后拿到跟 `completeSimple()` 一模一样的完整消息对象。两种用法互不冲突。

---

## 事件类型有哪些？

流中的每个事件都有一个 `type` 字段，告诉你这是什么类型的数据片段：

| type | 含义 | 你通常怎么处理 |
|------|------|--------------|
| `text_delta` | 一段文本片段到达 | `process.stdout.write(event.delta)` |
| `thinking_delta` | 一段思考内容到达 | 用灰色显示，或者忽略 |
| `toolcall_start` | 一个工具调用开始 | 显示"正在调用 xxx..." |
| `toolcall_delta` | 工具调用参数的片段 | 通常忽略 |
| `toolcall_end` | 工具调用完整了 | 拿到完整的 toolCall 对象 |
| `done` | 流正常结束 | 不需要处理，`for await` 会自动退出 |
| `error` | 流异常结束 | 不需要处理，`for await` 会自动退出 |

这一章只用到 `text_delta`。到第 06 章引入工具后，`toolcall_start` / `toolcall_end` 就派上用场了。

---

## 实际的 agent-loop.ts 怎么消费流？

看看我们项目中 `agent-loop.ts` 的 `consumeStream` 函数，就是这个模式：

```typescript
async function consumeStream(
  stream: AssistantMessageEventStream,
  config: AgentConfig
): Promise<AssistantMessage> {
  for await (const event of stream) {
    switch (event.type) {
      case "text_delta":
        config.onText?.(event.delta);        // 回调：逐 token 输出
        break;
      case "thinking_delta":
        config.onThinking?.(event.delta);    // 回调：思考内容
        break;
    }
  }
  return stream.result();  // 流结束，返回完整消息
}
```

整个函数做三件事：遍历事件、调用对应回调、返回最终结果。Agent Loop 的其余部分不关心流的细节，只拿到最终的 AssistantMessage 继续处理。

---

## push 和 next 的到达顺序

`AssistantMessageEventStream` 底层是一个队列。有两种时序：

**情况 A：数据先到，消费者后到**
```
模型产生 token → push 到队列 → 队列里存着
                                  ↓
                         消费者 for await → 立刻拿到
```

**情况 B：消费者先到，数据后到**
```
消费者 for await → 队列为空，挂起等待
                                  ↓
              模型产生 token → push → 唤醒消费者
```

两种情况都能正确工作，你不需要关心哪个先到。async iterable 的协议保证了这一点——这也是为什么 pi-ai 选择 async iterable 而不是 callback 的原因。callback 没有背压机制，如果消费者处理慢了，事件会堆积；async iterable 天然有背压，消费者不 `next()` 就不会继续推送。

---

## 为什么不用 callback？

你可能见过这种 callback 风格的流式 API：

```typescript
// callback 风格（不是 pi-ai 的做法）
streamWithCallback(context, {
  onToken: (token) => process.stdout.write(token),
  onDone: (message) => { /* ... */ },
  onError: (err) => { /* ... */ },
});
```

pi-ai 选择 async iterable 而不是 callback，有三个理由：

1. **背压**：消费者处理慢时，生产者自动等待，不会丢事件
2. **可组合**：可以用 `for await` + `break` 提前终止，可以传递给其他函数
3. **错误传播**：异常通过正常的 try/catch 冒泡，不需要单独的 onError

---

## 小结

`streamSimple()` 返回一个 `AssistantMessageEventStream`，它既是 async iterable（逐个消费事件），又持有最终结果（`stream.result()`）。用 `for await` 遍历就能实现逐 token 显示，流结束后拿到的 AssistantMessage 跟 `completeSimple()` 返回的结构完全一样。

从这一章开始，后续所有的 LLM 调用都用 `streamSimple()` —— Agent 需要实时显示输出给用户。

---

## 下一章

现在我们能调用模型、能流式输出了，但每次只能说一句话。如果用户想跟模型来回对话呢？模型不记得上一轮说了什么。下一章来看消息列表的累积机制——多轮对话的 messages 协议。

→ [第 03 章：多轮对话 — 消息协议与记忆](./03-multi-turn.md)
