# 第 12 章 Demo：上下文窗口管理

演示 Session vs Context 的分离，按预算裁剪，保证 toolCall/toolResult 配对完整。**不需要 API key。**

## 运行

```bash
cd demos/12-context-management
npm install
npx tsx main.ts                # 默认预算 1500 tokens
npx tsx main.ts --budget=500   # 极小预算，观察激进截断
npx tsx main.ts --budget=10000 # 大预算，不截断
```

## 学到什么

- Session（完整历史，永久存储）vs Context（每次调用临时构建）
- 交互分组：toolCall + toolResult 不可拆分
- 从后向前按预算保留最近的交互
- 被截断的旧历史压缩为摘要注入 systemPrompt
- Token 估算宁可高估（余量），不要低估（API 拒绝）
- 不变量：Context 中的 toolCall/toolResult 必须成对
