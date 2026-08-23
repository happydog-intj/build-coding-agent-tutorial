# 第 10 章 Demo：Stateful Agent

从纯函数演化为有状态的 Agent 类，支持 abort、steering、重入保护。

## 运行

```bash
cd demos/10-stateful-agent
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts
```

## 试试

```
> 帮我分析一下 TypeScript 和 Rust 的异同（会调用 think 工具）
   ← Agent 运行中按 Ctrl+C → 取消
> 用 5 个要点对比 Python 和 Go
   ← Agent 思考中输入 "别用工具直接回答" → steering 注入
```

## 学到什么

- `AbortController` + `signal` 传播到循环、流式调用、工具执行
- Steering 队列：`steer()` 入队，下一轮 `injectSteering()` 注入
- 重入保护：`running` 标志 + `finally` 保证重置
- Ctrl+C → `agent.abort()` vs `process.exit(0)` 取决于运行状态
- 有状态对象 = 可交互控制的长时间运行实体
