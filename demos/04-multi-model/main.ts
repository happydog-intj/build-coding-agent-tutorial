/**
 * 第 04 章：多模型适配 — 一套代码切换不同厂商
 *
 * 演示适配层的威力：同一个 streamFn 调用，通过切换 model 对象
 * 就能调用不同厂商的 API。Agent Loop 代码一个字不改。
 *
 * 运行方式（设置任意一个或多个 key）：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   OPENAI_API_KEY=sk-... npx tsx main.ts
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npx tsx main.ts  ← 对比两家
 *
 * 可选参数：
 *   npx tsx main.ts --model=gpt-4o
 *   npx tsx main.ts --model=claude-sonnet-4-20250514
 *   npx tsx main.ts --compare   ← 同时调用两个厂商对比
 */

import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Model, AssistantMessageEventStream } from "@earendil-works/pi-ai";

// ─── 初始化适配层 ────────────────────────────────────────────────────────────────
const models = builtinModels();

// ─── 统一的调用函数 — Agent Loop 就是这样用的 ──────────────────────────────────
async function askModel(model: Model<any>, prompt: string): Promise<{ text: string; tokens: string }> {
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Reply in Chinese. Be concise (1-2 sentences).",
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  };

  // 这一行对所有厂商都一样！适配层内部自动路由。
  const stream: AssistantMessageEventStream = models.streamSimple(model, context);

  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta") {
      text += event.delta;
    }
  }

  const msg = stream.result();
  return { text, tokens: `${msg.usage.input}+${msg.usage.output}` };
}

// ─── 解析 CLI 参数 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const compareMode = args.includes("--compare");
const modelArg = args.find(a => a.startsWith("--model="))?.split("=")[1];

const prompt = "什么是适配器模式（Adapter Pattern）？";

if (compareMode) {
  // 对比模式：同时调用多个厂商
  console.log(`\x1b[36m对比模式\x1b[0m — 同一个问题发给不同厂商\n`);
  console.log(`\x1b[90mQ: ${prompt}\x1b[0m\n`);

  const available: Array<{ name: string; model: Model<any> }> = [];

  if (process.env.ANTHROPIC_API_KEY) {
    available.push({ name: "Anthropic", model: getBuiltinModel("anthropic", "claude-sonnet-4-20250514") });
  }
  if (process.env.OPENAI_API_KEY) {
    available.push({ name: "OpenAI", model: getBuiltinModel("openai", "gpt-4o") });
  }

  if (available.length === 0) {
    console.error("至少设置一个 API key: ANTHROPIC_API_KEY 或 OPENAI_API_KEY");
    process.exit(1);
  }

  // 并行调用所有可用的厂商
  const results = await Promise.all(
    available.map(async ({ name, model }) => {
      const start = Date.now();
      const result = await askModel(model, prompt);
      const elapsed = Date.now() - start;
      return { name, model: model.id, ...result, elapsed };
    })
  );

  for (const r of results) {
    console.log(`\x1b[33m── ${r.name} (${r.model}) ──\x1b[0m`);
    console.log(r.text);
    console.log(`\x1b[90m[${r.tokens} tokens, ${r.elapsed}ms]\x1b[0m\n`);
  }
} else {
  // 单模型模式
  const model = modelArg
    ? resolveModel(modelArg)
    : process.env.ANTHROPIC_API_KEY
      ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
      : getBuiltinModel("openai", "gpt-4o");

  console.log(`\x1b[90m[model: ${model.id}]\x1b[0m\n`);

  const stream = models.streamSimple(model, {
    systemPrompt: "You are a helpful assistant. Reply in Chinese.",
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  } satisfies Context);

  for await (const event of stream) {
    if (event.type === "text_delta") process.stdout.write(event.delta);
  }

  const msg = stream.result();
  console.log(`\n\n\x1b[90m[tokens: ${msg.usage.input}+${msg.usage.output}]\x1b[0m`);
}

// ─── Helper ─────────────────────────────────────────────────────────────────────
function resolveModel(id: string): Model<any> {
  const map: Record<string, () => Model<any>> = {
    "claude-sonnet-4-20250514": () => getBuiltinModel("anthropic", "claude-sonnet-4-20250514"),
    "gpt-4o": () => getBuiltinModel("openai", "gpt-4o"),
    "gpt-4o-mini": () => getBuiltinModel("openai", "gpt-4o-mini"),
  };
  const getter = map[id];
  if (!getter) {
    console.error(`Unknown model: ${id}. Available: ${Object.keys(map).join(", ")}`);
    process.exit(1);
  }
  return getter();
}
