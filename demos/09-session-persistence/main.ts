/**
 * 第 09 章：会话持久化 — JSONL 崩溃安全存储
 *
 * 演示：
 * - JSONL 格式存储消息（每行一条，追加写入）
 * - 崩溃安全：部分写入的行被跳过
 * - 会话恢复：--resume=<session-id> 继续上次对话
 * - 多轮对话 + 持久化完整集成
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   npx tsx main.ts --resume=2024-06-15_143022_a7x2   ← 恢复会话
 *
 * 输入 /quit 退出，/session 查看会话信息，/history 查看 JSONL 文件内容
 */

import * as readline from "node:readline";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message } from "@earendil-works/pi-ai";

// ─── 初始化 ──────────────────────────────────────────────────────────────────────
const models = builtinModels();
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

// ─── Session 持久化实现 ──────────────────────────────────────────────────────────

const SESSIONS_DIR = join(process.cwd(), ".sessions");

function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}_${time}_${rand}`;
}

function getSessionPath(sessionId: string): string {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
  return join(SESSIONS_DIR, `${sessionId}.jsonl`);
}

/** 追加一条消息（同步写，崩溃安全） */
function appendMessage(sessionFile: string, message: Message): void {
  const dir = dirname(sessionFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(sessionFile, JSON.stringify(message) + "\n");
}

/** 加载会话（容忍损坏行） */
function loadSession(sessionFile: string): Message[] {
  if (!existsSync(sessionFile)) return [];
  const content = readFileSync(sessionFile, "utf-8");
  const messages: Message[] = [];
  let skipped = 0;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      skipped++;  // 跳过损坏行 — 崩溃安全
    }
  }

  if (skipped > 0) {
    console.log(`\x1b[33m⚠ Skipped ${skipped} corrupted line(s)\x1b[0m`);
  }
  return messages;
}

// ─── CLI 逻辑 ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const resumeArg = args.find(a => a.startsWith("--resume="))?.split("=")[1];

const sessionId = resumeArg ?? generateSessionId();
const sessionFile = getSessionPath(sessionId);
let messages: Message[] = resumeArg ? loadSession(sessionFile) : [];

console.log(`\x1b[36m第 09 章 Demo：Session Persistence\x1b[0m [${model.id}]`);
console.log(`\x1b[90mSession: ${sessionId}\x1b[0m`);
console.log(`\x1b[90mFile: ${sessionFile}\x1b[0m`);
if (messages.length > 0) {
  console.log(`\x1b[32mResumed: ${messages.length} messages loaded\x1b[0m`);
}
console.log(`\x1b[90mCommands: /quit /session /history\x1b[0m\n`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

while (true) {
  const input = await question("\x1b[36m> \x1b[0m");
  const trimmed = input.trim();
  if (!trimmed) continue;
  if (trimmed === "/quit") break;

  if (trimmed === "/session") {
    console.log(`\x1b[90m  ID: ${sessionId}`);
    console.log(`  File: ${sessionFile}`);
    console.log(`  Messages: ${messages.length}\x1b[0m\n`);
    continue;
  }

  if (trimmed === "/history") {
    if (!existsSync(sessionFile)) { console.log("\x1b[90m  (no file yet)\x1b[0m\n"); continue; }
    const raw = readFileSync(sessionFile, "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    console.log(`\x1b[90m  --- ${sessionFile} (${lines.length} lines) ---\x1b[0m`);
    for (const line of lines.slice(-6)) {
      try {
        const msg = JSON.parse(line);
        const preview = msg.role === "assistant"
          ? msg.content?.[0]?.text?.slice(0, 50) ?? "[toolCall]"
          : typeof msg.content === "string" ? msg.content.slice(0, 50) : "[complex]";
        console.log(`  \x1b[33m${msg.role}\x1b[0m: ${preview}`);
      } catch { console.log(`  \x1b[31m[corrupted]\x1b[0m`); }
    }
    if (lines.length > 6) console.log(`  \x1b[90m... and ${lines.length - 6} more\x1b[0m`);
    console.log();
    continue;
  }

  // 1. 用户消息
  const userMsg: Message = { role: "user", content: trimmed, timestamp: Date.now() };
  messages.push(userMsg);
  appendMessage(sessionFile, userMsg);  // 即时持久化

  // 2. 调用模型
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Reply in Chinese. Be concise.",
    messages,
  };

  console.log();
  const stream = models.streamSimple(model, context);
  for await (const e of stream) {
    if (e.type === "text_delta") process.stdout.write(e.delta);
  }
  const reply = stream.result();
  messages.push(reply);
  appendMessage(sessionFile, reply);  // 即时持久化

  console.log(`\n\x1b[90m[messages: ${messages.length} | saved to ${sessionId}.jsonl]\x1b[0m\n`);
}

rl.close();
console.log(`\n\x1b[90mSession saved: ${sessionFile}`);
console.log(`Resume with: npx tsx main.ts --resume=${sessionId}\x1b[0m`);
