# 第 17 章 Demo：Harness 工程

用 ScriptedModel 模拟故障场景，演示 Harness 四道防线。无需 API key。

## 运行

```bash
cd demos/17-harness
npm install
npx tsx main.ts
```

## 输出示例

```
═══ 场景 1：死循环 → Max Iterations ═══
  iterations: 6
  stopped by: max_iterations
  → Max Iterations 防止了无限循环（限制=5，实际跑了 6 轮）

═══ 场景 2：连续失败 → 策略切换 ═══
  stopped by: consecutive_errors_intervention
  intervention injected: true
  → 连续 3 次失败后注入提示，让模型换策略

═══ 场景 3：过早终止 → 输出验证 + 重试 ═══
  attempts: 2
  verified: true
  stopped by: verified
  → 第一次过早终止被验证器抓住，第二次重试后通过
```

## 学到什么

- Harness = Agent Loop 外层的控制、验证和修正层
- Max Iterations 是最简单也最重要的防护（防死循环）
- 连续失败检测 + 策略切换提示让模型有机会自我纠正
- 输出验证 + 自动重试解决模型"过早宣称完成"的问题
- Proposer-Reviewer 用两次 LLM 调用交叉验证高风险操作
- 关键认知：模型不可靠是常态，Harness 是模型之外的竞争力
