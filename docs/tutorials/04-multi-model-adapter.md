---
title: "多模型适配 — 一套代码切换 Anthropic 和 OpenAI"
description: "用适配器模式实现 Anthropic Claude 和 OpenAI GPT 的统一调用接口"
---

# 第 04 章：多模型适配 — 一套代码切换不同厂商

> Anthropic 和 OpenAI 的 API 格式完全不同，怎样用同一套代码无缝切换？

## 这一章要解决什么问题？

上几章的代码都写死了 `getBuiltinModel("anthropic", "claude-sonnet-4-20250514")`。如果你想换成 OpenAI 的 GPT-4o 试试，会发现 API 格式完全不一样 — 请求体结构不同、流式协议不同、工具调用的格式也不同。

难道要为每个厂商写一套 Agent Loop？当然不。这一章看 pi-ai 怎样用一个适配层，让 Agent Loop 只跟统一协议打交道，厂商差异止步于适配器内部。

---

## 核心不变量

先记住一条原则：**厂商专属格式止于适配层，不能进入 Agent Loop。**

Agent Loop 只认识 `Context`（输入）和 `AssistantMessage`（输出）。它不知道 Anthropic 用 `messages` API、OpenAI 用 `responses` API、消息格式有什么区别。这些翻译工作全部由适配层完成。

---

## 适配层的架构

数据流是这样的：

```
Agent Loop
  ↓ Context + Model
Adapter Layer (per vendor)
  ↓ HTTP request in vendor format
Anthropic / OpenAI / DeepSeek / Google / ...
  ↓ SSE stream in vendor format
Adapter Layer
  ↓ AssistantMessageEvent (unified)
Agent Loop
```

Agent Loop 发出统一的 Context，适配器翻译成厂商的 HTTP 请求格式。厂商返回的 SSE 流经过适配器翻译回统一的 AssistantMessageEvent。Agent Loop 完全不知道背后是哪个厂商。

---

## builtinModels() 做了什么？

```typescript
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const models = builtinModels();
```

这一行做了两件事：

1. 调用 `createModels()` 创建一个空的 Models 容器
2. 注册所有内置 provider（Anthropic、OpenAI、DeepSeek、Google、Azure 等 30 多个）

每个 provider 注册时带上自己的适配逻辑：
- 怎么把 Context 翻译成自己的请求格式
- 怎么把自己的响应流翻译回统一事件
- 怎么解析认证信息（环境变量名、格式）

注册完成后，`models` 容器就能处理任何已注册厂商的模型调用。

---

## getBuiltinModel() 做了什么？

```typescript
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";

const model = getBuiltinModel("anthropic", "claude-sonnet-4-20250514");
```

从内置模型目录中查找一个模型定义。返回的 Model 对象包含：
- `id`：模型标识（如 "claude-sonnet-4-20250514"）
- `provider`：属于哪个 provider（如 "anthropic"）
- `api`：使用哪种 API 协议（如 "anthropic-messages"）
- `contextWindow`：上下文窗口大小
- `maxTokens`：最大输出 token 数
- `cost`：价格信息

Model 对象本身不包含执行逻辑 — 它只是一个描述。执行逻辑在 provider 适配器里。

---

## 认证怎么解析？

每个 provider 注册时声明了自己需要哪个环境变量。调用时自动检查：

| Provider | 环境变量 | 格式 |
|----------|---------|------|
| Anthropic | `ANTHROPIC_API_KEY` | `sk-ant-...` |
| OpenAI | `OPENAI_API_KEY` | `sk-...` |
| DeepSeek | `DEEPSEEK_API_KEY` | `sk-...` |
| Google | `GOOGLE_API_KEY` | `AIza...` |

你设了哪个环境变量，对应的 provider 就能工作。不需要手动配置。

---

## 切换厂商：改一行代码

在我们项目的 `provider.ts` 中：

```typescript
export function setupProvider(modelId?: string): ProviderSetup {
  const models = builtinModels();
  const selectedModelId = modelId ?? process.env.PI_MODEL ?? detectDefaultModel();
  const model = resolveModel(selectedModelId);
  return { models, model };
}

function detectDefaultModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-20250514";
  if (process.env.OPENAI_API_KEY) return "gpt-4o";
  throw new Error("No API key found...");
}
```

切换厂商只需要改环境变量或传入不同的 modelId。Agent Loop 的代码一个字都不用改 — `config.streamFn(model, context)` 调用的是同一个 `models.streamSimple()`，适配层自动路由到对应的 provider。

运行时切换：

```bash
# 用 Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx npx tsx src/index.ts

# 用 OpenAI
OPENAI_API_KEY=sk-xxx npx tsx src/index.ts --model=gpt-4o
```

---

## 为什么不直接用 Anthropic SDK？

对比三种方案：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 直接调 Anthropic SDK | 简单直接 | 换厂商要改业务代码；工具格式要手动转换 |
| 自己写中间适配层 | 解耦 | 每加一个厂商写一套适配代码；维护成本高 |
| 用 pi-ai 统一接口 | 30+ 厂商免费获得；协议已经对齐 | 依赖一个库 |

对于教学项目，直接用 SDK 也可以。但如果你的 Agent 要支持多个厂商，或者将来想换模型试试效果，统一接口能省掉大量重复工作。

---

## Agent Loop 怎么使用适配层？

回忆一下 `agent-loop.ts` 中的 AgentConfig：

```typescript
interface AgentConfig {
  model: Model<any>;
  streamFn: (model: Model<any>, context: Context) => AssistantMessageEventStream;
  // ...
}
```

`streamFn` 就是连接 Agent Loop 和适配层的桥梁。在 `index.ts` 中，它被设置为：

```typescript
const config: AgentConfig = {
  model,
  streamFn: (m, ctx) => models.streamSimple(m, ctx),
  // ...
};
```

`models.streamSimple()` 内部做三件事：
1. 根据 `model.provider` 找到对应的适配器
2. 适配器把 Context 翻译成厂商格式的 HTTP 请求
3. 适配器把厂商返回的流翻译回 AssistantMessageEventStream

Agent Loop 只关心 `streamFn` 返回的 `AssistantMessageEventStream`，不关心内部发生了什么。

---

## 小结

pi-ai 通过适配层屏蔽了不同 LLM 厂商的 API 差异。`builtinModels()` 注册 30 多个内置 provider，`getBuiltinModel()` 获取模型元数据，`models.streamSimple()` 自动路由到对应适配器完成翻译。Agent Loop 只跟统一的 Context / AssistantMessage 协议打交道，厂商格式止于适配层内部。切换模型只需要改一个 ID 或一个环境变量。

---

## 下一章

到目前为止，我们每次测试都要调用真实的 API — 等响应、花钱、而且结果不可复现。有没有办法不调 API 也能验证 Agent 的逻辑是正确的？下一章来看"录播模型"：预设好模型的响应，在本地快速跑完整个 Agent Loop。

→ [第 05 章：模拟测试 — 不花钱验证 Agent 逻辑](./05-mock-testing.md)
