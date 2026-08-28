# 第 21 章 Demo：并行执行与成本控制

高效执行 + 预算管理：生产级 Agent 的两个关键能力。无需 API key。

## 运行

```bash
cd demos/21-parallel-and-cost
npm install
npx tsx main.ts
```

## 输出示例

```
═══ 场景 1：并行 vs 串行执行时间对比 ═══
  串行执行: ~500ms
  并行执行: ~200ms (concurrency=3)
  加速比: 2.5x

═══ 场景 2：超时处理 — 慢工具被取消 ═══
  ✓ fast_tool     fulfilled  fast_tool completed
  ✓ normal_tool   fulfilled  normal_tool completed
  ✗ slow_tool     rejected   slow_tool timed out

═══ 场景 3：Token 用量追踪 ═══
  call-1 (initial)       in: 1500 out: 400 cache_r:    0 cache_w: 1200
  call-2 (tool results)  in: 2800 out: 300 cache_r: 1200 cache_w:    0
  TOTAL                  in: 7500 out:1300 cache_r: 2400 cache_w: 1200

═══ 场景 4：Budget 超限 → 停止 Agent ═══
  总预算: 8000 tokens
  停止原因: budget_exceeded
  → 超限时优雅停止，返回已完成的工作
```

## 学到什么

- Semaphore 控制并发度：避免瞬时资源耗尽，同时保持并行加速
- Promise.allSettled 收集所有结果（不因一个失败丢弃其余）
- AbortSignal.timeout 实现单工具超时，不拖慢整体进度
- TokenTracker 逐次累计用量，精确追踪成本
- Budget 守卫在每次 LLM 调用后检查，超限时优雅停止而非崩溃
- Cache tokens 比 input tokens 便宜 10x — 多轮对话自动受益
