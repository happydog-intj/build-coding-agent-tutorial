/**
 * 第 02 章：EventStream — 流式输出，逐 token 显示
 *
 * 演示 streamSimple() 的用法：
 * - AssistantMessageEventStream 是 async iterable
 * - for await 遍历事件，逐 token 写到终端
 * - 流结束后 stream.result() 拿到完整 AssistantMessage
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   OPENAI_API_KEY=sk-... npx tsx main.ts
 */

import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, AssistantMessageEventStream } from "@earendil-works/pi-ai";

// ─── 初始化 ──────────────────────────────────────────────────────────────────────
const models = builtinModels();
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

const userPrompt = process.argv[2] ?? "用三句话解释 TypeScript 的类型系统";

const context: Context = {
  systemPrompt: "You are a helpful assistant. Reply in Chinese.",
  messages: [
    { role: "user", content: userPrompt, timestamp: Date.now() },
  ],
};

console.log(`\x1b[90m[model: ${model.id}]\x1b[0m`);
console.log(`\x1b[90m[prompt: ${userPrompt}]\x1b[0m\n`);

// ─── 流式调用 ────────────────────────────────────────────────────────────────────
const stream: AssistantMessageEventStream = models.streamSimple(model, context);

// 统计事件数
let eventCount = 0;

// for await 逐个消费事件
for await (const event of stream) {
  switch (event.type) {
    case "text_delta":
      // 核心：逐 token 写到终端（不换行）
      process.stdout.write(event.delta);
      eventCount++;
      break;
    case "thinking_delta":
      // 思考内容用灰色显示
      process.stdout.write(`\x1b[90m${event.delta}\x1b[0m`);
      break;
  }
}

// ─── 流结束后，取出完整的 AssistantMessage ─────────────────────────────────────
const message = stream.result();

console.log(`\n\n\x1b[90m[events: ${eventCount} text_delta | tokens: ${message.usage.input}+${message.usage.output} | stop: ${message.stopReason}]\x1b[0m`);
