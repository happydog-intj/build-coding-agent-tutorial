# 第 15 章 Demo：评测 — 证明你的 Agent 能工作

自动化评测两层体系：逻辑评测（不需要 API key）+ 能力评测（需要真实模型）。

## 运行

```bash
cd demos/15-evaluation
npm install

# 全部运行（逻辑层无需 key，能力层需要 key）
npx tsx main.ts

# 只跑逻辑评测（无需 API key！）
npx tsx main.ts --logic

# 只跑能力评测（需要 API key）
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts --capability
```

## 评测输出示例

```
═══ 逻辑评测 (Agent Loop 行为) ═══

  ✓ terminates-without-tool-calls (2ms)
  ✓ executes-tool-and-pairs-result (5ms)
  ✓ sets-isError-on-failure (3ms)
  ✓ handles-unknown-tool (2ms)

4/4 passed

═══ 能力评测 (Agent 实际任务) ═══

  ✓ create-file-with-content (1200ms)
  ✓ read-and-answer (2100ms)
  ✓ fix-syntax-error (3400ms)

3/3 passed
```

## 学到什么

- EvalCase = prepare() + prompt + verify()：搭建环境 → Agent 执行 → 检查结果
- Runner 在隔离的临时目录中执行每个用例，互不干扰
- 第一层用 ScriptedModel 测试 Agent Loop 逻辑（快速、确定性、免费）
- 第二层用真实模型测试 Agent 能力（验证结果不验证过程）
- 评测让你有信心说"我的 Agent 能工作"——通过自动化测试覆盖，而非"试了一次能跑"
- 退出码 0/1 可集成到 CI 流水线
