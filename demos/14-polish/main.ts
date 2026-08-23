/**
 * 第 14 章：打磨 — 从 Demo 到可用产品
 *
 * 完整的 CLI Coding Agent，集成所有前面章节的概念：
 * - 启动 Banner（模型、工具、退出方式）
 * - ANSI 彩色输出（视觉层次）
 * - 斜杠命令（/quit /clear /session /help）
 * - CLI 参数（--model= --resume=）
 * - 工具调用可视化（名称 + 关键参数 + 结果预览）
 * - JSONL 会话持久化
 * - 三层错误处理
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   npx tsx main.ts --model=gpt-4o
 *   npx tsx main.ts --resume=<session-id>
 */

import * as readline from "node:readline";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message, Tool, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";

// ─── CLI 参数解析 ────────────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const modelArg = cliArgs.find(a => a.startsWith("--model="))?.split("=")[1];
const resumeArg = cliArgs.find(a => a.startsWith("--resume="))?.split("=")[1];

// ─── Provider 初始化 ─────────────────────────────────────────────────────────────
const models = builtinModels();

function pickModel() {
  const id = modelArg ?? process.env.PI_MODEL;
  if (id === "gpt-4o") return getBuiltinModel("openai", "gpt-4o");
  if (id === "gpt-4o-mini") return getBuiltinModel("openai", "gpt-4o-mini");
  if (process.env.ANTHROPIC_API_KEY) return getBuiltinModel("anthropic", "claude-sonnet-4-20250514");
  if (process.env.OPENAI_API_KEY) return getBuiltinModel("openai", "gpt-4o");
  console.error("\x1b[31mNo API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.\x1b[0m");
  process.exit(1);
}

const model = pickModel();

// ─── Session 持久化 ──────────────────────────────────────────────────────────────
const SESSIONS_DIR = join(process.cwd(), ".sessions");

function genSessionId(): string {
  const now = new Date();
  return `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 19).replace(/:/g, "")}_${Math.random().toString(36).slice(2, 6)}`;
}

const sessionId = resumeArg ?? genSessionId();
const sessionFile = join(SESSIONS_DIR, `${sessionId}.jsonl`);

function saveMsg(msg: Message) {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
  appendFileSync(sessionFile, JSON.stringify(msg) + "\n");
}

function loadMsgs(): Message[] {
  if (!existsSync(sessionFile)) return [];
  const messages: Message[] = [];
  for (const line of readFileSync(sessionFile, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { messages.push(JSON.parse(line)); } catch {}
  }
  return messages;
}

// ─── 工具定义 ────────────────────────────────────────────────────────────────────
interface ToolResult { content: string; isError?: boolean; }
interface MiniTool { name: string; description: string; parameters: object; execute: (p: any) => Promise<ToolResult>; }

const allTools: MiniTool[] = [
  {
    name: "read_file", description: "Read file with line numbers. Supports offset/limit.",
    parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, required: ["path"] },
    async execute(p) {
      try {
        const content = await readFile(resolve(p.path), "utf-8");
        const lines = content.split("\n");
        const off = Math.max(1, p.offset ?? 1);
        const lim = p.limit ?? lines.length;
        const slice = lines.slice(off - 1, off - 1 + lim);
        return { content: `${resolve(p.path)} (${lines.length} lines)\n${slice.map((l, i) => `${off + i}\t${l}`).join("\n")}` };
      } catch (e: any) { return { content: e.code === "ENOENT" ? `File not found: ${p.path}` : e.message, isError: true }; }
    },
  },
  {
    name: "write_file", description: "Create/overwrite file. Auto-creates directories.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    async execute(p) {
      try {
        await mkdir(dirname(resolve(p.path)), { recursive: true });
        await writeFile(resolve(p.path), p.content, "utf-8");
        return { content: `Wrote ${p.content.split("\n").length} lines to ${p.path}` };
      } catch (e: any) { return { content: e.message, isError: true }; }
    },
  },
  {
    name: "edit_file", description: "Replace exact string in file. old_string must be unique.",
    parameters: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } }, required: ["path", "old_string", "new_string"] },
    async execute(p) {
      try {
        const content = await readFile(resolve(p.path), "utf-8");
        const count = content.split(p.old_string).length - 1;
        if (count === 0) return { content: `old_string not found in ${p.path}`, isError: true };
        if (count > 1) return { content: `old_string found ${count} times — must be unique`, isError: true };
        await writeFile(resolve(p.path), content.replace(p.old_string, p.new_string), "utf-8");
        return { content: `Edited ${p.path}` };
      } catch (e: any) { return { content: e.message, isError: true }; }
    },
  },
  {
    name: "bash", description: "Run shell command. Timeout 30s. Output truncated if >5000 chars.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    async execute(p) {
      return new Promise(res => {
        exec(p.command, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err?.killed) { res({ content: "Timed out after 30s", isError: true }); return; }
          let out = (stdout + (stderr ? "\n" + stderr : "")) || "(no output)";
          if (out.length > 5000) out = out.slice(0, 2500) + "\n...(truncated)...\n" + out.slice(-2500);
          res({ content: out, isError: err !== null });
        });
      });
    },
  },
];

// ─── Agent Loop ─────────────────────────────────────────────────────────────────

async function runAgent(prompt: string, messages: Message[]): Promise<void> {
  const userMsg: Message = { role: "user", content: prompt, timestamp: Date.now() };
  messages.push(userMsg);
  saveMsg(userMsg);

  const toolSchemas: Tool[] = allTools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters as any }));

  while (true) {
    const context: Context = {
      systemPrompt: `You are a coding assistant. Tools: read_file, write_file, edit_file, bash.\nCurrent directory: ${process.cwd()}\nReply in Chinese. Be concise.`,
      messages,
      tools: toolSchemas,
    };

    const stream: AssistantMessageEventStream = models.streamSimple(model, context);
    for await (const e of stream) {
      if (e.type === "text_delta") process.stdout.write(e.delta);
      if (e.type === "thinking_delta") process.stdout.write(`\x1b[90m${e.delta}\x1b[0m`);
    }
    const reply = stream.result();
    messages.push(reply);
    saveMsg(reply);

    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      console.log(`\n\x1b[31m[${(reply as any).errorMessage ?? reply.stopReason}]\x1b[0m`);
      break;
    }

    const toolCalls = reply.content.filter((c): c is any => c.type === "toolCall");
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      console.log(`\n\x1b[33m⚡ ${tc.name}\x1b[0m \x1b[90m${formatArgs(tc.name, tc.arguments)}\x1b[0m`);
      const tool = allTools.find(t => t.name === tc.name);
      let result: ToolResult;
      if (!tool) { result = { content: `Unknown tool: ${tc.name}`, isError: true }; }
      else { try { result = await tool.execute(tc.arguments); } catch (e: any) { result = { content: e.message, isError: true }; } }

      const preview = result.content.slice(0, 100).replace(/\n/g, " ");
      console.log(`${result.isError ? "\x1b[31m✗" : "\x1b[32m✓"} ${tc.name}\x1b[0m \x1b[90m${preview}${result.content.length > 100 ? "..." : ""}\x1b[0m\n`);

      const trMsg: any = { role: "toolResult", toolCallId: tc.id, toolName: tc.name, content: [{ type: "text", text: result.content }], isError: result.isError ?? false, timestamp: Date.now() };
      messages.push(trMsg);
      saveMsg(trMsg);
    }
  }
}

function formatArgs(name: string, args: any): string {
  if (name === "bash") return args.command?.slice(0, 60) ?? "";
  if (["read_file", "write_file", "edit_file"].includes(name)) return args.path ?? "";
  return JSON.stringify(args).slice(0, 60);
}

// ─── Main ────────────────────────────────────────────────────────────────────────

let messages: Message[] = resumeArg ? loadMsgs() : [];

// Banner
console.log("\x1b[36m╭───────────────────────────────────────╮\x1b[0m");
console.log("\x1b[36m│\x1b[0m  \x1b[1mMini Pi Coding Agent\x1b[0m — Ch.14 Demo  \x1b[36m│\x1b[0m");
console.log(`\x1b[36m│\x1b[0m  Model: \x1b[33m${model.id.padEnd(29)}\x1b[0m\x1b[36m│\x1b[0m`);
console.log("\x1b[36m│\x1b[0m  Tools: read, write, edit, bash       \x1b[36m│\x1b[0m");
console.log("\x1b[36m│\x1b[0m  /help for commands                   \x1b[36m│\x1b[0m");
console.log("\x1b[36m╰───────────────────────────────────────╯\x1b[0m");
if (messages.length > 0) console.log(`\x1b[90mResumed: ${messages.length} messages from ${sessionId}\x1b[0m`);
console.log();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (p: string): Promise<string> => new Promise(r => rl.question(p, r));

while (true) {
  const input = await question("\x1b[36m❯ \x1b[0m");
  const t = input.trim();
  if (!t) continue;

  if (t === "/quit" || t === "/exit") break;
  if (t === "/clear") { messages = []; console.log("\x1b[90mCleared.\x1b[0m\n"); continue; }
  if (t === "/session") { console.log(`\x1b[90mSession: ${sessionId} | Messages: ${messages.length} | File: ${sessionFile}\x1b[0m\n`); continue; }
  if (t === "/help") {
    console.log("\x1b[90m  /quit    — exit\n  /clear   — clear session\n  /session — show info\n  /help    — this message\x1b[0m\n");
    continue;
  }

  console.log();
  await runAgent(t, messages);
  console.log("\n");
}

rl.close();
console.log(`\x1b[90mGoodbye! Session: ${sessionId}\x1b[0m`);
