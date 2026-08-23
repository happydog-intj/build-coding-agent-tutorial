/**
 * 第 06 章：Tool Use — 让 LLM 调用函数
 *
 * 手动完成一次完整的 tool use 流程：
 * 1. 定义工具 schema → 传给模型
 * 2. 模型返回 toolCall → 程序执行工具
 * 3. 构造 toolResult → 再次调用模型
 * 4. 模型给出最终回复
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   OPENAI_API_KEY=sk-... npx tsx main.ts
 */

import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message, Tool } from "@earendil-works/pi-ai";

// ─── 初始化 ──────────────────────────────────────────────────────────────────────
const models = builtinModels();
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

console.log(`\x1b[36m第 06 章 Demo：Tool Use\x1b[0m [model: ${model.id}]\n`);

// ─── 定义工具 ────────────────────────────────────────────────────────────────────

// 工具 1：获取当前时间
function executeGetTime(): string {
  return new Date().toISOString();
}

// 工具 2：简单的计算器
function executeCalculate(params: { expression: string }): string {
  try {
    // 安全地计算简单数学表达式
    const allowed = /^[\d\s+\-*/().]+$/;
    if (!allowed.test(params.expression)) {
      return `Error: unsafe expression "${params.expression}"`;
    }
    const result = Function(`"use strict"; return (${params.expression})`)();
    return String(result);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

// 工具 schema（传给模型看的）
const tools: Tool[] = [
  {
    name: "get_current_time",
    description: "Get the current date and time in ISO format. Use when user asks about current time or date.",
    parameters: { type: "object", properties: {} } as any,
  },
  {
    name: "calculate",
    description: "Evaluate a mathematical expression and return the result. Supports +, -, *, /, parentheses.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Math expression, e.g. '(3 + 4) * 2'" },
      },
      required: ["expression"],
    } as any,
  },
];

// 工具执行分发
function executeTool(name: string, args: any): string {
  switch (name) {
    case "get_current_time": return executeGetTime();
    case "calculate": return executeCalculate(args);
    default: return `Error: unknown tool "${name}"`;
  }
}

// ─── 运行：手动完成 tool use 流程 ───────────────────────────────────────────────

const userPrompt = process.argv[2] ?? "现在几点了？另外帮我算一下 (15 + 27) * 3";

const messages: Message[] = [
  { role: "user", content: userPrompt, timestamp: Date.now() },
];

console.log(`\x1b[90mUser: ${userPrompt}\x1b[0m\n`);

// ─── 第 1 次调用模型 ─────────────────────────────────────────────────────────────
console.log("\x1b[90m--- 第 1 次调用模型 ---\x1b[0m");

const context1: Context = { systemPrompt: "Reply in Chinese. Be concise.", messages, tools };
const stream1 = models.streamSimple(model, context1);

for await (const event of stream1) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}
const reply1 = stream1.result();
messages.push(reply1);

console.log(`\x1b[90m[stopReason: ${reply1.stopReason}]\x1b[0m\n`);

// ─── 检查 toolCall 并执行 ────────────────────────────────────────────────────────
const toolCalls = reply1.content.filter((c): c is any => c.type === "toolCall");

if (toolCalls.length === 0) {
  console.log("\x1b[90m模型没有调用工具，直接回答了。\x1b[0m");
  process.exit(0);
}

console.log(`\x1b[33m模型请求了 ${toolCalls.length} 个工具调用：\x1b[0m`);
for (const tc of toolCalls) {
  console.log(`  \x1b[33m⚡ ${tc.name}\x1b[0m(${JSON.stringify(tc.arguments)})`);

  // 执行工具
  const result = executeTool(tc.name, tc.arguments);
  console.log(`  \x1b[32m→ ${result}\x1b[0m`);

  // 构造 toolResult（注意 toolCallId 配对！）
  messages.push({
    role: "toolResult",
    toolCallId: tc.id,       // ← 必须与 toolCall.id 配对
    toolName: tc.name,
    content: [{ type: "text", text: result }],
    isError: false,
    timestamp: Date.now(),
  } as any);
}

// ─── 第 2 次调用模型（带工具结果） ──────────────────────────────────────────────
console.log(`\n\x1b[90m--- 第 2 次调用模型（messages 包含 toolResult） ---\x1b[0m`);

const context2: Context = { systemPrompt: "Reply in Chinese. Be concise.", messages, tools };
const stream2 = models.streamSimple(model, context2);

for await (const event of stream2) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}
const reply2 = stream2.result();
messages.push(reply2);

console.log(`\n\n\x1b[90m[stopReason: ${reply2.stopReason} | total messages: ${messages.length} | LLM calls: 2]\x1b[0m`);

// ─── 打印完整 messages 结构 ──────────────────────────────────────────────────────
console.log(`\n\x1b[90m--- 完整消息序列 ---\x1b[0m`);
for (let i = 0; i < messages.length; i++) {
  const m = messages[i] as any;
  let preview: string;
  if (m.role === "user") preview = typeof m.content === "string" ? m.content.slice(0, 40) : "[complex]";
  else if (m.role === "assistant") preview = m.content.map((c: any) => c.type === "text" ? c.text.slice(0, 30) : `[${c.type}:${c.name}]`).join(" | ");
  else preview = `toolCallId=${m.toolCallId} → ${m.content?.[0]?.text?.slice(0, 30)}`;
  console.log(`  [${i}] \x1b[33m${m.role.padEnd(10)}\x1b[0m ${preview}`);
}
