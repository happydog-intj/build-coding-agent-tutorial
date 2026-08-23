# 第 07 章 Demo：Agent Loop

while 循环实现自主多步任务。模型连续调用多个工具直到任务完成。

## 运行

```bash
cd demos/07-agent-loop
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts

# 自定义任务
npx tsx main.ts "列出当前目录的文件并读取 README.md"
```

## 学到什么

- Agent Loop = `while(true) { callLLM → hasToolCalls? → execute → loop }`
- 退出条件：`toolCalls.length === 0`（模型完成）或 `stopReason === "error"`
- 设计原则 #1：LLM 调用永不 throw，错误编码在 stopReason
- 设计原则 #2：工具失败返回错误内容，让模型自行处理
- 模型能自主决定调用顺序和次数，无需人工编排
