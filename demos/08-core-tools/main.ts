/**
 * 第 08 章：核心工具 — read / write / edit / bash
 *
 * 完整的 4 工具 Coding Agent。可以：
 * - 读取文件（带行号、支持分段）
 * - 创建文件（自动建目录）
 * - 编辑文件（字符串精确匹配替换）
 * - 执行命令（timeout + 中间截断）
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   OPENAI_API_KEY=sk-... npx tsx main.ts
 *
 * 示例任务：
 *   npx tsx main.ts "创建一个 hello.ts 文件，内容是打印 Hello World，然后运行它"
 *   npx tsx main.ts "读取 package.json，把 name 改成 my-cool-agent"
 */

import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message, Tool, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { resolve, dirname } from "node:path";

// ─── 初始化 ──────────────────────────────────────────────────────────────────────
const models = builtinModels();
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

// ─── 工具定义 ────────────────────────────────────────────────────────────────────

interface ToolResult { content: string; isError?: boolean; }
interface MiniTool {
  name: string;
  description: string;
  parameters: object;
  execute: (params: any) => Promise<ToolResult>;
}

const MAX_OUTPUT = 10_000;
const TIMEOUT_MS = 30_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT) return output;
  const half = Math.floor(MAX_OUTPUT / 2);
  return `${output.slice(0, half)}\n\n... (${output.length - MAX_OUTPUT} chars omitted) ...\n\n${output.slice(-half)}`;
}

const tools: MiniTool[] = [
  // ── read_file ──
  {
    name: "read_file",
    description: "Read file contents with line numbers. Use offset/limit for large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        offset: { type: "number", description: "Start line (1-indexed, default: 1)" },
        limit: { type: "number", description: "Max lines to read" },
      },
      required: ["path"],
    },
    async execute(params) {
      try {
        const filePath = resolve(params.path);
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const offset = Math.max(1, params.offset ?? 1);
        const limit = params.limit ?? lines.length;
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join("\n");
        return { content: `${filePath} (${lines.length} lines)\n${numbered}` };
      } catch (e: any) {
        if (e.code === "ENOENT") return { content: `File not found: ${params.path}`, isError: true };
        if (e.code === "EISDIR") return { content: `Path is a directory: ${params.path}`, isError: true };
        return { content: `Cannot read: ${e.message}`, isError: true };
      }
    },
  },

  // ── write_file ──
  {
    name: "write_file",
    description: "Create or overwrite a file. Auto-creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
    async execute(params) {
      try {
        const filePath = resolve(params.path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, params.content, "utf-8");
        const lines = params.content.split("\n").length;
        return { content: `Wrote ${lines} lines to ${params.path}` };
      } catch (e: any) {
        return { content: `Failed to write: ${e.message}`, isError: true };
      }
    },
  },

  // ── edit_file ──
  {
    name: "edit_file",
    description: "Edit file by replacing exact string match. old_string must be unique in the file. Use read_file first.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string", description: "Exact text to find (must be unique)" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"],
    },
    async execute(params) {
      try {
        const filePath = resolve(params.path);
        const content = await readFile(filePath, "utf-8");
        const count = content.split(params.old_string).length - 1;

        if (count === 0) {
          const fuzzy = content.includes(params.old_string.trim());
          return { content: `old_string not found in ${params.path}.${fuzzy ? " (Trimmed version found — check whitespace.)" : ""}`, isError: true };
        }
        if (count > 1) {
          return { content: `old_string found ${count} times — must be unique. Add more context.`, isError: true };
        }

        const newContent = content.replace(params.old_string, params.new_string);
        await writeFile(filePath, newContent, "utf-8");
        return { content: `Edited ${params.path}` };
      } catch (e: any) {
        if (e.code === "ENOENT") return { content: `File not found: ${params.path}`, isError: true };
        return { content: `Edit failed: ${e.message}`, isError: true };
      }
    },
  },

  // ── bash ──
  {
    name: "bash",
    description: "Execute shell command. Returns stdout+stderr. Timeout: 30s. Output truncated if too long.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        timeout: { type: "number", description: "Timeout ms (default 30000)" },
      },
      required: ["command"],
    },
    async execute(params) {
      const timeout = params.timeout ?? TIMEOUT_MS;
      return new Promise((res) => {
        exec(params.command, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
          if (error?.killed) { res({ content: `Timed out after ${timeout}ms`, isError: true }); return; }
          const output = stdout + (stderr ? "\n" + stderr : "");
          res({ content: truncateOutput(output || "(no output)"), isError: error !== null });
        });
      });
    },
  },
];

// ─── Agent Loop ─────────────────────────────────────────────────────────────────

async function runAgent(prompt: string): Promise<void> {
  const messages: Message[] = [{ role: "user", content: prompt, timestamp: Date.now() }];
  const toolSchemas: Tool[] = tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters as any }));
  let loops = 0;

  while (true) {
    loops++;
    const context: Context = {
      systemPrompt: `You are a coding assistant. Use tools to accomplish tasks. Current directory: ${process.cwd()}. Reply in Chinese.`,
      messages,
      tools: toolSchemas,
    };

    const stream: AssistantMessageEventStream = models.streamSimple(model, context);
    for await (const e of stream) { if (e.type === "text_delta") process.stdout.write(e.delta); }
    const reply = stream.result();
    messages.push(reply);

    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      console.log(`\n\x1b[31m[Error: ${(reply as any).errorMessage ?? reply.stopReason}]\x1b[0m`);
      break;
    }

    const toolCalls = reply.content.filter((c): c is any => c.type === "toolCall");
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      console.log(`\n\x1b[33m⚡ ${tc.name}\x1b[0m \x1b[90m${formatArgs(tc.name, tc.arguments)}\x1b[0m`);
      const tool = tools.find(t => t.name === tc.name);
      let result: ToolResult;
      if (!tool) { result = { content: `Unknown tool: ${tc.name}`, isError: true }; }
      else { try { result = await tool.execute(tc.arguments); } catch (e: any) { result = { content: e.message, isError: true }; } }

      const preview = result.content.slice(0, 100).replace(/\n/g, "\\n");
      console.log(`${result.isError ? "\x1b[31m✗" : "\x1b[32m✓"}\x1b[0m \x1b[90m${preview}${result.content.length > 100 ? "..." : ""}\x1b[0m\n`);

      messages.push({ role: "toolResult", toolCallId: tc.id, toolName: tc.name, content: [{ type: "text", text: result.content }], isError: result.isError ?? false, timestamp: Date.now() } as any);
    }
  }

  console.log(`\n\n\x1b[90m[${loops} loops, ${messages.length} messages]\x1b[0m`);
}

function formatArgs(name: string, args: any): string {
  if (name === "bash") return args.command?.slice(0, 60) ?? "";
  if (name === "read_file" || name === "write_file" || name === "edit_file") return args.path ?? "";
  return JSON.stringify(args).slice(0, 60);
}

// ─── Main ────────────────────────────────────────────────────────────────────────

console.log(`\x1b[36m第 08 章 Demo：Core Tools Agent\x1b[0m [${model.id}]\n`);

const prompt = process.argv[2] ?? "创建一个 /tmp/demo-hello.ts，内容是 console.log('Hello from Agent!')，然后用 npx tsx 运行它";
console.log(`\x1b[90mUser: ${prompt}\x1b[0m\n`);

await runAgent(prompt);
