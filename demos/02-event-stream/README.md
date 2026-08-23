# 第 02 章 Demo：EventStream 流式输出

从 `completeSimple()` 切换到 `streamSimple()`，实现逐 token 显示。

## 运行

```bash
cd demos/02-event-stream
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts
```

## 学到什么

- `streamSimple()` 返回 `AssistantMessageEventStream`（async iterable）
- `for await (const event of stream)` 逐个消费事件
- `event.type === "text_delta"` 是最常用的事件，`event.delta` 是文本片段
- 流结束后 `stream.result()` 返回完整的 `AssistantMessage`
- 背压机制：消费者不 next() 就不会继续推送
