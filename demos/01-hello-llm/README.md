# 第 01 章 Demo：Hello LLM

最简单的一次 LLM 调用。发送 Context，接收 AssistantMessage。

## 运行

```bash
cd demos/01-hello-llm
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx main.ts

# 或用 OpenAI
OPENAI_API_KEY=sk-xxx npx tsx main.ts

# 自定义问题
npx tsx main.ts "什么是 RAG？"
```

## 学到什么

- `builtinModels()` 创建 Models 容器，注册所有内置 provider
- `getBuiltinModel(provider, modelId)` 获取模型定义
- `Context = { systemPrompt, messages, tools }` 是模型的全部输入
- `completeSimple()` 阻塞调用，等全部生成完返回
