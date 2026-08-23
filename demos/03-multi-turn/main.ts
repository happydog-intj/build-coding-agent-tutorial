/**
 * 第 03 章：多轮对话 — 消息协议与记忆
 *
 * 演示 messages 累积机制：
 * - LLM 没有记忆，每次传完整 messages 实现"记住上下文"
 * - 三种消息角色：user / assistant / toolResult
 * - messages 数组逐轮增长
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   OPENAI_API_KEY=sk-... npx tsx main.ts
 *
 * 输入 /quit 退出，/messages 查看当前消息列表
 */

import * as readline from "node:readline";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message } from "@earendil-works/pi-ai";

// ─── 初始化 ──────────────────────────────────────────────────────────────────────
const models = builtinModels();
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

// messages 数组 — 这就是模型的"记忆"
const messages: Message[] = [];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

console.log(`\x1b[36m多轮对话 Demo\x1b[0m [model: ${model.id}]`);
console.log(`\x1b[90m输入 /quit 退出 | /messages 查看消息列表\x1b[0m\n`);

// ─── 对话循环 ────────────────────────────────────────────────────────────────────
while (true) {
  const input = await question("\x1b[36m> \x1b[0m");
  const trimmed = input.trim();

  if (!trimmed) continue;
  if (trimmed === "/quit") break;

  // 调试命令：查看当前 messages 结构
  if (trimmed === "/messages") {
    console.log(`\n\x1b[90m--- messages (${messages.length} 条) ---\x1b[0m`);
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const preview = msg.role === "assistant"
        ? msg.content.map(c => c.type === "text" ? c.text.slice(0, 50) : `[${c.type}]`).join(" ")
        : typeof msg.content === "string" ? msg.content.slice(0, 50) : "[complex]";
      console.log(`  [${i}] \x1b[33m${msg.role}\x1b[0m: ${preview}`);
    }
    console.log(`\x1b[90m--- end ---\x1b[0m\n`);
    continue;
  }

  // 1. 用户消息加入列表
  messages.push({ role: "user", content: trimmed, timestamp: Date.now() });

  // 2. 构建 Context — 每次都传完整的 messages
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Reply in Chinese. Be concise.",
    messages,  // ← 完整历史！模型能看到所有之前的对话
  };

  // 3. 流式调用模型
  console.log();
  const stream = models.streamSimple(model, context);
  for await (const event of stream) {
    if (event.type === "text_delta") {
      process.stdout.write(event.delta);
    }
  }

  // 4. 模型回复加入列表
  const reply = stream.result();
  messages.push(reply);

  console.log(`\n\x1b[90m[messages: ${messages.length} | tokens: ${reply.usage.input}+${reply.usage.output}]\x1b[0m\n`);
}

rl.close();
console.log("\x1b[90mGoodbye!\x1b[0m");
