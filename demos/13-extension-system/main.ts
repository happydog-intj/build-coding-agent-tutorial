/**
 * 第 13 章：扩展系统 — 不污染核心的产品化
 *
 * 演示三种扩展机制：
 * 1. 知识注入（getSystemPrompt）— 动态拼接 system prompt
 * 2. 行为拦截（beforeToolCall/afterToolCall）— 权限控制 + 结果变换
 * 3. 事件系统（onText/onToolCall/onToolResult）— 外部观察
 *
 * Agent Loop 核心代码不变（~80 行），所有产品化逻辑通过配置注入。
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *
 * 试试让模型执行危险命令（如 rm -rf），观察权限确认拦截。
 */

import * as readline from "node:readline";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message, Tool, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ─── 初始化 ──────────────────────────────────────────────────────────────────────
const models = builtinModels();
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

// ─── 类型定义 ────────────────────────────────────────────────────────────────────
interface ToolResult { content: string; isError?: boolean; }
interface MiniTool {
  name: string; description: string; parameters: object;
  execute: (params: any) => Promise<ToolResult>;
}

// ─── 扩展版 AgentConfig ─────────────────────────────────────────────────────────
interface AgentConfig {
  model: any;
  streamFn: (ctx: Context, opts?: any) => AssistantMessageEventStream;
  tools: MiniTool[];
  systemPrompt: string;

  // ─── 扩展点 ───
  getSystemPrompt?: () => string;                                    // 知识注入
  beforeToolCall?: (name: string, args: any) => Promise<boolean>;    // 行为拦截
  afterToolCall?: (name: string, result: ToolResult) => ToolResult;  // 结果变换
  onText?: (text: string) => void;                                   // 事件
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
}

// ─── Agent Loop（支持扩展点） ────────────────────────────────────────────────────

async function runAgent(prompt: string, messages: Message[], config: AgentConfig): Promise<void> {
  messages.push({ role: "user", content: prompt, timestamp: Date.now() });

  const toolSchemas: Tool[] = config.tools.map(t => ({
    name: t.name, description: t.description, parameters: t.parameters as any,
  }));

  while (true) {
    // 知识注入：动态 system prompt
    const systemPrompt = config.getSystemPrompt?.() ?? config.systemPrompt;

    const context: Context = { systemPrompt, messages, tools: toolSchemas };
    const stream = config.streamFn(context);

    for await (const e of stream) {
      if (e.type === "text_delta") config.onText?.(e.delta);
    }
    const reply = stream.result();
    messages.push(reply);

    if (reply.stopReason === "error" || reply.stopReason === "aborted") break;

    const toolCalls = reply.content.filter((c): c is any => c.type === "toolCall");
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      config.onToolCall?.(tc.name, tc.arguments);

      // 行为拦截：beforeToolCall
      const allowed = await config.beforeToolCall?.(tc.name, tc.arguments) ?? true;

      let result: ToolResult;
      if (!allowed) {
        // 被拒绝 — 但仍生成 toolResult 保持配对
        result = { content: "Tool call was rejected by user.", isError: true };
      } else {
        const tool = config.tools.find(t => t.name === tc.name);
        if (!tool) { result = { content: `Unknown tool: ${tc.name}`, isError: true }; }
        else {
          try { result = await tool.execute(tc.arguments); }
          catch (e: any) { result = { content: e.message, isError: true }; }
        }

        // 行为拦截：afterToolCall（结果变换）
        if (config.afterToolCall) {
          result = config.afterToolCall(tc.name, result);
        }
      }

      config.onToolResult?.(tc.name, result);

      messages.push({
        role: "toolResult", toolCallId: tc.id, toolName: tc.name,
        content: [{ type: "text", text: result.content }],
        isError: result.isError ?? false, timestamp: Date.now(),
      } as any);
    }
  }
}

// ─── 工具定义 ────────────────────────────────────────────────────────────────────

const tools: MiniTool[] = [
  {
    name: "read_file",
    description: "Read file contents.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    async execute(params) {
      try { return { content: await readFile(resolve(params.path), "utf-8") }; }
      catch (e: any) { return { content: e.message, isError: true }; }
    },
  },
  {
    name: "bash",
    description: "Execute shell command. Timeout 10s.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    async execute(params) {
      return new Promise(res => {
        exec(params.command, { timeout: 10_000 }, (err, stdout, stderr) => {
          if (err?.killed) { res({ content: "Timed out", isError: true }); return; }
          res({ content: (stdout + stderr).slice(0, 5000) || "(no output)", isError: err !== null });
        });
      });
    },
  },
];

// ─── 配置扩展点 ─────────────────────────────────────────────────────────────────

// 危险命令列表
const DANGEROUS = ["rm -rf", "sudo", "mkfs", "dd ", "> /dev/", "chmod 777", ":(){ :|:& };:"];

function isDangerous(command: string): boolean {
  return DANGEROUS.some(d => command.includes(d));
}

// 用于权限确认的 readline
async function confirmAction(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => rl.question(prompt, resolve));
  rl.close();
  return answer.toLowerCase() === "y";
}

// 日志记录（事件系统的应用）
const eventLog: string[] = [];

const config: AgentConfig = {
  model,
  streamFn: (ctx) => models.streamSimple(model, ctx),
  tools,
  systemPrompt: "You are a coding assistant.",

  // ─── 知识注入 ───
  getSystemPrompt: () => {
    return [
      "You are a coding assistant with access to read_file and bash tools.",
      `Current directory: ${process.cwd()}`,
      `Current time: ${new Date().toISOString()}`,
      `Platform: ${process.platform}`,
      "",
      "Guidelines:",
      "- Be concise. Reply in Chinese.",
      "- Use tools when needed to accomplish tasks.",
    ].join("\n");
  },

  // ─── 行为拦截：权限控制 ───
  beforeToolCall: async (name, args) => {
    if (name === "bash" && isDangerous(args.command)) {
      console.log(`\n\x1b[31m⚠️  危险命令检测！\x1b[0m`);
      return confirmAction(`  执行 "${args.command}"? [y/N] `);
    }
    return true;  // 默认允许
  },

  // ─── 行为拦截：结果变换 ───
  afterToolCall: (name, result) => {
    // 截断过长输出
    if (result.content.length > 3000) {
      const head = result.content.slice(0, 1500);
      const tail = result.content.slice(-1500);
      return { ...result, content: `${head}\n\n... (truncated) ...\n\n${tail}` };
    }
    // 脱敏：隐藏环境变量中的 key
    if (name === "bash" && result.content.includes("API_KEY")) {
      return { ...result, content: result.content.replace(/sk-[a-zA-Z0-9-]+/g, "sk-***") };
    }
    return result;
  },

  // ─── 事件系统 ───
  onText: (text) => {
    process.stdout.write(text);
  },
  onToolCall: (name, args) => {
    const argsPreview = name === "bash" ? args.command?.slice(0, 50) : args.path ?? "";
    console.log(`\n\x1b[33m⚡ ${name}\x1b[0m \x1b[90m${argsPreview}\x1b[0m`);
    eventLog.push(`[tool_call] ${name}(${argsPreview})`);
  },
  onToolResult: (name, result) => {
    const status = result.isError ? "\x1b[31m✗\x1b[0m" : "\x1b[32m✓\x1b[0m";
    const preview = result.content.slice(0, 60).replace(/\n/g, "\\n");
    console.log(`${status} \x1b[90m${preview}${result.content.length > 60 ? "..." : ""}\x1b[0m\n`);
    eventLog.push(`[tool_result] ${name}: ${result.isError ? "ERROR" : "OK"}`);
  },
};

// ─── CLI ─────────────────────────────────────────────────────────────────────────

console.log(`\x1b[36m第 13 章 Demo：Extension System\x1b[0m [${model.id}]`);
console.log(`\x1b[90m扩展点: getSystemPrompt + beforeToolCall + afterToolCall + events\x1b[0m`);
console.log(`\x1b[90m试试让模型执行 "rm -rf /tmp/test" 观察权限拦截\x1b[0m`);
console.log(`\x1b[90m命令: /log 查看事件日志 | /quit 退出\x1b[0m\n`);

const messages: Message[] = [];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

while (true) {
  const input = await question("\x1b[36m> \x1b[0m");
  const trimmed = input.trim();
  if (!trimmed) continue;
  if (trimmed === "/quit") break;

  if (trimmed === "/log") {
    console.log(`\n\x1b[90m--- Event Log (${eventLog.length} entries) ---\x1b[0m`);
    eventLog.slice(-10).forEach(e => console.log(`  ${e}`));
    console.log();
    continue;
  }

  console.log();
  await runAgent(trimmed, messages, config);
  console.log("\n");
}

rl.close();
console.log(`\x1b[90m[Session: ${messages.length} messages | Events: ${eventLog.length}]\x1b[0m`);
