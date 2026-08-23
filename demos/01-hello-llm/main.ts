/**
 * 第 01 章：Hello LLM — 30 行代码调用大模型
 *
 * 演示最简单的一次 LLM 调用：发送 Context，接收 AssistantMessage。
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   OPENAI_API_KEY=sk-... npx tsx main.ts
 *
 * 可选参数：
 *   npx tsx main.ts "你的自定义问题"
 */

import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context } from "@earendil-works/pi-ai";

// ─── 1. 初始化 Models 容器（注册所有内置 provider） ─────────────────────────────
const models = builtinModels();

// ─── 2. 选择模型（根据环境变量自动选择） ─────────────────────────────────────────
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

// ─── 3. 用户输入（CLI 参数或默认） ──────────────────────────────────────────────
const userPrompt = process.argv[2] ?? "用一句话解释什么是 Agent Loop";

// ─── 4. 构建 Context — 模型看到的全部输入 ───────────────────────────────────────
const context: Context = {
  systemPrompt: "You are a helpful assistant. Reply in Chinese.",
  messages: [
    { role: "user", content: userPrompt, timestamp: Date.now() },
  ],
  // tools 不传 — 模型只能用文本回答
};

console.log(`\x1b[90m[model: ${model.id}]\x1b[0m`);
console.log(`\x1b[90m[prompt: ${userPrompt}]\x1b[0m\n`);

// ─── 5. 调用模型，等待完整回复 ──────────────────────────────────────────────────
const response = await models.completeSimple(model, context);

// ─── 6. 打印结果 ────────────────────────────────────────────────────────────────
const text = response.content.find(c => c.type === "text");
console.log(text ? text.text : "(no text response)");
console.log(`\n\x1b[90m[tokens: ${response.usage.input} input + ${response.usage.output} output]\x1b[0m`);
