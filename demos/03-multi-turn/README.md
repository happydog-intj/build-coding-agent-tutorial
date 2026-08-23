# 第 03 章 Demo：多轮对话

演示 messages 累积机制。每次调用模型都传完整历史，模型才能"记住"上下文。

## 运行

```bash
cd demos/03-multi-turn
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts
```

## 试试

```
> TypeScript 有哪些基础类型？
> 展开说说 number
> 它和 bigint 有什么区别？
> /messages    ← 查看当前 messages 数组结构
```

## 学到什么

- LLM 没有记忆，多轮对话靠 messages 数组累积
- 每次调用模型传完整的 messages（context.messages）
- 三种角色：user / assistant / toolResult
- `assistant.content` 是数组（可以同时包含文本和工具调用）
- messages 会逐轮增长，后续需要上下文窗口管理（第 12 章）
