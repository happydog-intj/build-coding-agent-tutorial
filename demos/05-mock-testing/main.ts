/**
 * 第 05 章：模拟测试 — 不花钱验证 Agent 逻辑
 *
 * 无需 API key！用"录播模型"替换真实 API，确定性验证 Agent 行为。
 *
 * 核心思路：
 * - streamFn 是 Agent Loop 和 API 之间的边界
 * - 替换 streamFn 就能用预设响应替代真实调用
 * - 同时快照每次调用的 Context，事后断言行为路径
 *
 * 运行方式（不需要任何 API key）：
 *   npx tsx main.ts
 */

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Message,
  Tool,
} from "@earendil-works/pi-ai";

// ══════════════════════════════════════════════════════════════════════════════════
// 录播模型实现
// ══════════════════════════════════════════════════════════════════════════════════

interface ScriptedModel {
  callCount: number;
  calls: Context[];
  next(ctx: Context): AssistantMessageEventStream;
}

function createScriptedModel(responses: AssistantMessage[]): ScriptedModel {
  let cursor = 0;
  const calls: Context[] = [];

  return {
    get callCount() { return calls.length; },
    get calls() { return calls; },

    next(ctx: Context): AssistantMessageEventStream {
      calls.push(structuredClone(ctx));  // 深拷贝快照

      if (cursor >= responses.length) {
        throw new Error(
          `ScriptedModel exhausted: called ${cursor + 1} times, only ${responses.length} responses`
        );
      }

      const response = responses[cursor++];

      // 用一个简单的 async generator 模拟 AssistantMessageEventStream
      const events: any[] = [];
      for (const block of response.content) {
        if (block.type === "text") {
          events.push({ type: "text_delta", delta: block.text });
        }
      }

      // 返回一个符合 AsyncIterable + result() 接口的对象
      let resolved = false;
      const stream = {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < events.length) return { value: events[i++], done: false };
              resolved = true;
              return { value: undefined, done: true };
            },
          };
        },
        result() { return response; },
      } as unknown as AssistantMessageEventStream;

      return stream;
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════════
// 简化版 Agent Loop（从第 07 章提前引入，方便演示）
// ══════════════════════════════════════════════════════════════════════════════════

interface ToolResult { content: string; isError?: boolean; }
interface MiniTool {
  name: string;
  description: string;
  parameters: object;
  execute: (params: Record<string, any>) => Promise<ToolResult>;
}
interface AgentConfig {
  streamFn: (ctx: Context) => AssistantMessageEventStream;
  tools: MiniTool[];
  systemPrompt: string;
}

async function runAgent(prompt: string, messages: Message[], config: AgentConfig): Promise<Message[]> {
  messages.push({ role: "user", content: prompt, timestamp: Date.now() });

  const toolSchemas: Tool[] = config.tools.map(t => ({
    name: t.name, description: t.description, parameters: t.parameters as any,
  }));

  while (true) {
    const context: Context = { systemPrompt: config.systemPrompt, messages, tools: toolSchemas };
    const stream = config.streamFn(context);

    // 消费流
    for await (const _ of stream) { /* 忽略事件 */ }
    const assistantMsg = stream.result();
    messages.push(assistantMsg);

    if (assistantMsg.stopReason === "error") break;

    const toolCalls = assistantMsg.content.filter((c): c is any => c.type === "toolCall");
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      const tool = config.tools.find(t => t.name === tc.name);
      let result: ToolResult;
      if (!tool) {
        result = { content: `Unknown tool: ${tc.name}`, isError: true };
      } else {
        try { result = await tool.execute(tc.arguments); }
        catch (e: any) { result = { content: e.message, isError: true }; }
      }
      messages.push({
        role: "toolResult", toolCallId: tc.id, toolName: tc.name,
        content: [{ type: "text", text: result.content }],
        isError: result.isError ?? false, timestamp: Date.now(),
      } as any);
    }
  }
  return messages;
}

// ══════════════════════════════════════════════════════════════════════════════════
// 测试场景：验证"读取文件并总结"的完整路径
// ══════════════════════════════════════════════════════════════════════════════════

console.log("\x1b[36m第 05 章 Demo：录播模型测试\x1b[0m\n");

// 1. 准备假工具
const fakeReadFile: MiniTool = {
  name: "read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async execute(params) {
    console.log(`  \x1b[90m[fake tool] read_file("${params.path}") → 返回预设内容\x1b[0m`);
    return { content: "# Hello World\n\nThis is a README with 3 lines of content." };
  },
};

// 2. 预设响应序列
const now = Date.now();
const scripted = createScriptedModel([
  // 第 1 轮：模型决定调用 read_file
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "tc_001", name: "read_file", arguments: { path: "README.md" } }],
    stopReason: "toolUse",
    usage: { input: 80, output: 15, cacheRead: 0, cacheWrite: 0, totalTokens: 95, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    model: "scripted", api: "anthropic-messages", provider: "test", timestamp: now,
  } as any,
  // 第 2 轮：模型给出总结
  {
    role: "assistant",
    content: [{ type: "text", text: "这个 README 文件包含一个标题和 3 行内容，是一个简单的项目说明文件。" }],
    stopReason: "stop",
    usage: { input: 120, output: 25, cacheRead: 0, cacheWrite: 0, totalTokens: 145, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    model: "scripted", api: "anthropic-messages", provider: "test", timestamp: now,
  } as any,
]);

// 3. 运行 Agent
const messages: Message[] = [];
const config: AgentConfig = {
  streamFn: (ctx) => scripted.next(ctx),
  tools: [fakeReadFile],
  systemPrompt: "You are a helpful assistant.",
};

console.log("运行 Agent: \"总结 README.md\"\n");
await runAgent("总结 README.md", messages, config);

// 4. 断言
console.log("\n\x1b[33m── 断言 ──\x1b[0m");

function assert(condition: boolean, msg: string) {
  console.log(condition ? `  \x1b[32m✓\x1b[0m ${msg}` : `  \x1b[31m✗\x1b[0m ${msg}`);
  if (!condition) process.exitCode = 1;
}

assert(scripted.callCount === 2, "模型被调用了 2 次");

assert(scripted.calls[0].messages.length === 1, "第 1 次调用只有 1 条 user 消息");

const secondCallMsgs = scripted.calls[1].messages;
const hasToolResult = secondCallMsgs.some((m: any) => m.role === "toolResult");
assert(hasToolResult, "第 2 次调用包含 toolResult");

const lastMsg = messages[messages.length - 1];
assert(lastMsg.role === "assistant", "最终消息是 assistant 回复");
assert(
  (lastMsg as any).content[0]?.text?.includes("README"),
  "回复内容提到了 README"
);

console.log(`\n\x1b[90m[总消息数: ${messages.length} | 模型调用: ${scripted.callCount} 次 | 费用: $0]\x1b[0m`);
