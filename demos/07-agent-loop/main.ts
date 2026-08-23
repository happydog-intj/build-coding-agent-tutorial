/**
 * 第 07 章：Agent Loop — 从一次调用到自主循环
 *
 * 把"调用模型 → 有 toolCall？→ 执行工具 → 传回结果"包进 while 循环。
 * 模型可以连续调用多个工具，自主完成多步任务。
 *
 * 演示场景：模型使用 list_files + read_file + calculate 三个工具
 * 自主完成"统计目录下文件数量并计算总行数"的任务。
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *   OPENAI_API_KEY=sk-... npx tsx main.ts
 */

import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message, Tool, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";

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

const tools: MiniTool[] = [
  {
    name: "list_files",
    description: "List files in a directory. Returns one filename per line.",
    parameters: {
      type: "object",
      properties: { directory: { type: "string", description: "Directory path to list" } },
      required: ["directory"],
    },
    async execute(params) {
      try {
        const entries = fs.readdirSync(params.directory);
        return { content: entries.join("\n") };
      } catch (e: any) {
        return { content: `Error: ${e.message}`, isError: true };
      }
    },
  },
  {
    name: "read_file",
    description: "Read the content of a file. Returns the file content as text.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File path to read" } },
      required: ["path"],
    },
    async execute(params) {
      try {
        const content = fs.readFileSync(params.path, "utf-8");
        return { content };
      } catch (e: any) {
        return { content: `Error: ${e.message}`, isError: true };
      }
    },
  },
  {
    name: "calculate",
    description: "Evaluate a math expression. Supports +, -, *, /, parentheses.",
    parameters: {
      type: "object",
      properties: { expression: { type: "string", description: "e.g. '3 + 4 * 2'" } },
      required: ["expression"],
    },
    async execute(params) {
      try {
        const allowed = /^[\d\s+\-*/().]+$/;
        if (!allowed.test(params.expression)) return { content: "Error: unsafe expression", isError: true };
        const result = Function(`"use strict"; return (${params.expression})`)();
        return { content: String(result) };
      } catch (e: any) {
        return { content: `Error: ${e.message}`, isError: true };
      }
    },
  },
];

// ─── Agent Loop 实现 ─────────────────────────────────────────────────────────────

async function runAgent(prompt: string): Promise<Message[]> {
  const messages: Message[] = [
    { role: "user", content: prompt, timestamp: Date.now() },
  ];

  const toolSchemas: Tool[] = tools.map(t => ({
    name: t.name, description: t.description, parameters: t.parameters as any,
  }));

  let loopCount = 0;

  while (true) {
    loopCount++;
    console.log(`\x1b[90m--- 循环 #${loopCount} (messages: ${messages.length}) ---\x1b[0m`);

    // 1. 构建 Context，调用模型
    const context: Context = {
      systemPrompt: "You are a helpful assistant. Use tools to accomplish tasks. Reply in Chinese.",
      messages,
      tools: toolSchemas,
    };

    const stream: AssistantMessageEventStream = models.streamSimple(model, context);

    // 消费流，显示文本
    for await (const event of stream) {
      if (event.type === "text_delta") process.stdout.write(event.delta);
    }
    const assistantMsg = stream.result();
    messages.push(assistantMsg);

    // 2. 检查错误
    if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
      console.log(`\n\x1b[31m[Error: ${(assistantMsg as any).errorMessage ?? "unknown"}]\x1b[0m`);
      break;
    }

    // 3. 提取 toolCall — 核心判断
    const toolCalls = assistantMsg.content.filter((c): c is any => c.type === "toolCall");
    if (toolCalls.length === 0) {
      // 没有工具调用 → 模型完成了 → 退出循环
      console.log();
      break;
    }

    // 4. 执行工具
    for (const tc of toolCalls) {
      console.log(`\n  \x1b[33m⚡ ${tc.name}\x1b[0m(${JSON.stringify(tc.arguments).slice(0, 60)})`);

      const tool = tools.find(t => t.name === tc.name);
      let result: ToolResult;

      if (!tool) {
        result = { content: `Unknown tool: "${tc.name}"`, isError: true };
      } else {
        try {
          result = await tool.execute(tc.arguments);
        } catch (e: any) {
          result = { content: `Error: ${e.message}`, isError: true };
        }
      }

      const preview = result.content.slice(0, 80).replace(/\n/g, "\\n");
      console.log(`  ${result.isError ? "\x1b[31m✗" : "\x1b[32m✓"}\x1b[0m ${preview}${result.content.length > 80 ? "..." : ""}`);

      // 5. 构造 toolResult
      messages.push({
        role: "toolResult",
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: "text", text: result.content }],
        isError: result.isError ?? false,
        timestamp: Date.now(),
      } as any);
    }
    console.log();
  }

  console.log(`\n\x1b[90m[完成: ${loopCount} 次循环, ${messages.length} 条消息]\x1b[0m`);
  return messages;
}

// ─── 运行 ────────────────────────────────────────────────────────────────────────

console.log(`\x1b[36m第 07 章 Demo：Agent Loop\x1b[0m [model: ${model.id}]\n`);

const prompt = process.argv[2] ?? `列出当前目录下的文件，然后读取 package.json，告诉我这个项目的名字和依赖数量`;
console.log(`\x1b[90mUser: ${prompt}\x1b[0m\n`);

await runAgent(prompt);
