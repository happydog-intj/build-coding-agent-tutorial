# 第 06 章 Demo：Tool Use

手动完成一次完整的工具调用流程。两个工具：获取时间 + 计算器。

## 运行

```bash
cd demos/06-tool-use
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts

# 自定义问题
npx tsx main.ts "帮我算 (100 - 37) / 9"
```

## 学到什么

- Tool = JSON Schema 声明（name + description + parameters）
- 模型返回 `toolCall`（表达意图），程序执行工具
- `toolResult.toolCallId` 必须与 `toolCall.id` 配对
- `stopReason: "toolUse"` 表示模型在等工具结果
- 一次 tool use 需要 2 次 LLM 调用（请求工具 + 消化结果）
- 模型可以一次返回多个 toolCall（并行工具调用）
