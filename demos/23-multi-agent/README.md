# 第 23 章 Demo：多 Agent 协作

用 ScriptedModel 模拟 Coordinator + Worker 模式的 Code Review 场景。无需 API key。

## 运行

```bash
cd demos/23-multi-agent
npm install
npx tsx main.ts
```

## 输出示例

```
═══ 阶段 1：Coordinator 分解任务 ═══
  任务分解结果：
    → [security-reviewer] Review for security vulnerabilities...
    → [perf-reviewer] Review for performance issues...
    → [style-reviewer] Review for code style...

═══ 阶段 2：Workers 并行执行 ═══
  [security-reviewer] 发现 2 个问题
    1. [CRITICAL] SQL injection: raw user input in query string
    2. [WARNING] Missing input validation on email field
  [perf-reviewer] 发现 1 个问题
    1. [CRITICAL] Unbounded query without LIMIT
  [style-reviewer] 发现 3 个问题
    1. [WARNING] Function `processData` exceeds 50 lines
    2. [INFO] Unused import `lodash`
    3. [INFO] No JSDoc on public API method

═══ 阶段 3：Coordinator 汇总结果 ═══
  ## PR Review Summary
  ### Critical (2)
  - SQL injection in user query (security)
  - Unbounded query without LIMIT (perf)
  ### Verdict: REQUEST CHANGES
```

## 学到什么

- SubAgent = 独立 system prompt + 独立消息历史，实现上下文隔离
- Coordinator 负责"全局视角"：分解任务、分发、汇总结论
- Workers 并行执行、互不干扰，各自专注一个审查维度
- 多 Agent 协作让系统能力超越单个模型的局限
- 关键认知：好的架构是让多个"专家"各司其职，而非一个"全能选手"独撑
