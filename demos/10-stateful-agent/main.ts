/**
 * 第 10 章：有状态 Agent — abort、steering 与重入保护
 *
 * 从纯函数 runAgent() 演化为有状态的 Agent 类：
 * - abort()：Ctrl+C 取消当前运行
 * - steer()：运行中注入新指令
 * - 重入保护：防止并行修改 messages
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *
 * 交互：
 *   - Ctrl+C：取消当前 Agent 运行
 *   - 输入时 Agent 在跑：消息进入 steering 队列，下轮注入
 */

import * as readline from "node:readline";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message, Tool, AssistantMessageEventStream } from "@earendil-works/pi-ai";

// ─── 初始化 ──────────────────────────────────────────────────────────────────────
const models = builtinModels();
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

// ─── 工具 ────────────────────────────────────────────────────────────────────────
interface ToolResult { content: string; isError?: boolean; }

const tools = [
  {
    name: "think",
    description: "Think step by step about a problem. Use this to organize your thoughts before answering.",
    parameters: { type: "object", properties: { thought: { type: "string" } }, required: ["thought"] },
    async execute(params: any): Promise<ToolResult> {
      // 模拟一个耗时操作（让用户有时间按 Ctrl+C 或输入 steering）
      await new Promise(r => setTimeout(r, 1000));
      return { content: `Thought noted: ${params.thought}` };
    },
  },
  {
    name: "get_info",
    description: "Get information about a topic (simulated). Use when you need facts.",
    parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
    async execute(params: any): Promise<ToolResult> {
      await new Promise(r => setTimeout(r, 500));
      return { content: `Info about "${params.topic}": This is simulated data for demo purposes.` };
    },
  },
];

// ─── Agent 类 ────────────────────────────────────────────────────────────────────

class Agent {
  private _running = false;
  private abortController: AbortController | null = null;
  private messages: Message[] = [];
  private steeringQueue: string[] = [];

  get isRunning(): boolean { return this._running; }
  get messageCount(): number { return this.messages.length; }

  /** 运行 Agent（重入保护） */
  async run(prompt: string): Promise<void> {
    if (this._running) {
      throw new Error("Agent is already running. Use steer() to inject messages.");
    }

    this._running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      this.messages.push({ role: "user", content: prompt, timestamp: Date.now() });

      const toolSchemas: Tool[] = tools.map(t => ({
        name: t.name, description: t.description, parameters: t.parameters as any,
      }));

      let loopCount = 0;

      while (true) {
        // 检查取消
        if (signal.aborted) {
          console.log(`\n\x1b[33m⚠ Aborted at loop #${loopCount + 1}\x1b[0m`);
          break;
        }

        // 注入 steering 消息
        this.injectSteering();

        loopCount++;
        const context: Context = {
          systemPrompt: "You are a helpful assistant. Reply in Chinese. Use tools when helpful.",
          messages: this.messages,
          tools: toolSchemas,
        };

        const stream: AssistantMessageEventStream = models.streamSimple(model, context, { signal });

        try {
          for await (const event of stream) {
            if (event.type === "text_delta") process.stdout.write(event.delta);
          }
        } catch (e: any) {
          if (signal.aborted) {
            console.log(`\n\x1b[33m⚠ Stream aborted\x1b[0m`);
            break;
          }
          throw e;
        }

        const reply = stream.result();
        this.messages.push(reply);

        if (reply.stopReason === "error" || reply.stopReason === "aborted") break;

        const toolCalls = reply.content.filter((c): c is any => c.type === "toolCall");
        if (toolCalls.length === 0) break;

        for (const tc of toolCalls) {
          if (signal.aborted) break;  // 工具执行前再检查

          console.log(`\n  \x1b[33m⚡ ${tc.name}\x1b[0m`);
          const tool = tools.find(t => t.name === tc.name);
          let result: ToolResult;
          if (!tool) { result = { content: `Unknown tool: ${tc.name}`, isError: true }; }
          else {
            try { result = await tool.execute(tc.arguments); }
            catch (e: any) { result = { content: e.message, isError: true }; }
          }
          console.log(`  \x1b[32m✓\x1b[0m \x1b[90m${result.content.slice(0, 60)}\x1b[0m`);

          this.messages.push({
            role: "toolResult", toolCallId: tc.id, toolName: tc.name,
            content: [{ type: "text", text: result.content }],
            isError: result.isError ?? false, timestamp: Date.now(),
          } as any);
        }
        console.log();
      }
    } finally {
      this._running = false;
      this.abortController = null;
    }
  }

  /** 取消当前运行 */
  abort(): void {
    this.abortController?.abort();
  }

  /** 运行中注入指令（下一轮模型调用前生效） */
  steer(message: string): void {
    this.steeringQueue.push(message);
    console.log(`\x1b[90m[steering queued: "${message.slice(0, 40)}"]\x1b[0m`);
  }

  private injectSteering(): void {
    while (this.steeringQueue.length > 0) {
      const msg = this.steeringQueue.shift()!;
      this.messages.push({ role: "user", content: msg, timestamp: Date.now() });
      console.log(`\x1b[35m[steering injected: "${msg.slice(0, 40)}"]\x1b[0m`);
    }
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────

console.log(`\x1b[36m第 10 章 Demo：Stateful Agent\x1b[0m [${model.id}]`);
console.log(`\x1b[90mCtrl+C = abort | 运行中输入 = steering | /quit = exit\x1b[0m\n`);

const agent = new Agent();

// Ctrl+C 处理
process.on("SIGINT", () => {
  if (agent.isRunning) {
    agent.abort();
  } else {
    console.log("\n\x1b[90mGoodbye!\x1b[0m");
    process.exit(0);
  }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

while (true) {
  const input = await question("\x1b[36m> \x1b[0m");
  const trimmed = input.trim();
  if (!trimmed) continue;
  if (trimmed === "/quit") break;

  if (trimmed === "/status") {
    console.log(`\x1b[90m  running: ${agent.isRunning} | messages: ${agent.messageCount}\x1b[0m\n`);
    continue;
  }

  console.log();
  try {
    await agent.run(trimmed);
  } catch (e: any) {
    if (e.message.includes("already running")) {
      // 重入保护触发 → 改为 steering
      agent.steer(trimmed);
    } else {
      console.log(`\x1b[31mError: ${e.message}\x1b[0m`);
    }
  }
  console.log("\n");
}

rl.close();
console.log("\x1b[90mGoodbye!\x1b[0m");
