# 第 05 章 Demo：模拟测试

用"录播模型"替代真实 API，确定性验证 Agent 的完整行为路径。**不需要 API key。**

## 运行

```bash
cd demos/05-mock-testing
npm install
npx tsx main.ts    # 无需任何 API key！
```

## 输出示例

```
运行 Agent: "总结 README.md"

  [fake tool] read_file("README.md") → 返回预设内容

── 断言 ──
  ✓ 模型被调用了 2 次
  ✓ 第 1 次调用只有 1 条 user 消息
  ✓ 第 2 次调用包含 toolResult
  ✓ 最终消息是 assistant 回复
  ✓ 回复内容提到了 README
```

## 学到什么

- `streamFn` 是 Agent Loop 和 API 的边界 → 替换它就能 mock
- `createScriptedModel(responses[])` 按顺序播放预设响应
- `scripted.calls` 快照每次调用的 Context → 断言行为路径
- 测试的是 Agent 的行为过程（调了几次、传了什么），不只是最终结果
- 确定性 + 免费 + 毫秒级执行
