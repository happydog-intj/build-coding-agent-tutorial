/**
 * 第 20 章：CLI 工具扩展 — Agent 最自然的能力接口
 *
 * 演示：
 * 1. Agent 友好的 CLI 设计（结构化 JSON 输出、退出码、--help、非交互）
 * 2. 工具清单文件（JSON 描述可用 CLI，供 Agent 发现）
 * 3. Agent 通过 bash 调用 CLI 并解析 JSON 输出
 * 4. 人类友好 vs Agent 友好输出对比
 *
 * 无需 API key！使用 ScriptedModel 模拟。
 *
 * 运行方式：
 *   npx tsx main.ts
 */

import type { AssistantMessage, AssistantMessageEventStream, Context, Message } from "@earendil-works/pi-ai";

// ─── ScriptedModel ──────────────────────────────────────────────────────────
function createScriptedModel(responses: AssistantMessage[]) {
  let cursor = 0;
  return {
    get callCount() { return cursor; },
    next(_ctx: Context): AssistantMessageEventStream {
      if (cursor >= responses.length) cursor = responses.length - 1;
      const response = responses[cursor++];
      return {
        [Symbol.asyncIterator]() {
          let done = false;
          return { async next() { if (done) return { value: undefined, done: true }; done = true; return { value: { type: "text_delta", delta: "" }, done: false }; } };
        },
        result() { return response; },
      } as any;
    },
  };
}

// ─── Mock CLI: my-deploy ────────────────────────────────────────────────────
// 模拟一个部署 CLI，支持 human 和 JSON 两种输出格式

interface DeployResult {
  status: "success" | "failed";
  environment: string;
  version: string;
  url: string;
  duration_ms: number;
  timestamp: string;
}

function mockDeployHuman(env: string): string {
  return [
    `🚀 Deploying to ${env}...`,
    `   Building...  done (3.2s)`,
    `   Uploading... done (1.1s)`,
    `   Activating.. done (0.5s)`,
    ``,
    `✅ Deploy successful!`,
    `   Version: v2.4.1`,
    `   URL: https://${env}.example.com`,
    `   Total time: 4.8s`,
  ].join("\n");
}

function mockDeployJSON(env: string): DeployResult {
  return {
    status: "success",
    environment: env,
    version: "v2.4.1",
    url: `https://${env}.example.com`,
    duration_ms: 4800,
    timestamp: new Date().toISOString(),
  };
}

// ─── Tool Manifest ──────────────────────────────────────────────────────────
// Agent 通过读取这个文件来发现可用的 CLI 工具

const TOOL_MANIFEST = {
  version: "1.0",
  tools: [
    {
      name: "my-deploy",
      path: "/usr/local/bin/my-deploy",
      description: "Deploy application to specified environment",
      usage: "my-deploy <environment> [--json] [--dry-run]",
      flags: {
        "--json": "Output structured JSON instead of human-readable text",
        "--dry-run": "Simulate without actual deployment",
        "--version": "Show CLI version",
        "--help": "Show usage information",
      },
      exit_codes: { 0: "success", 1: "deployment failed", 2: "invalid arguments" },
      examples: [
        "my-deploy staging --json",
        "my-deploy production --dry-run --json",
      ],
    },
    {
      name: "my-logs",
      path: "/usr/local/bin/my-logs",
      description: "Query application logs with structured output",
      usage: "my-logs --service <name> --since <duration> [--json] [--level error|warn|info]",
      flags: {
        "--json": "Output JSON lines (one JSON object per log entry)",
        "--service": "Service name to query",
        "--since": "Time window (e.g. 5m, 1h, 1d)",
        "--level": "Filter by log level",
      },
      exit_codes: { 0: "success", 1: "query failed", 2: "invalid arguments" },
      examples: [
        "my-logs --service api --since 5m --json --level error",
      ],
    },
  ],
};

// ─── Mock Bash Tool ─────────────────────────────────────────────────────────
// 模拟 Agent 的 bash 工具执行

interface ToolResult { content: string; isError?: boolean; }

function executeBash(command: string): ToolResult {
  // 解析 CLI 调用
  if (command.includes("cat") && command.includes("tool-manifest.json")) {
    return { content: JSON.stringify(TOOL_MANIFEST, null, 2) };
  }
  if (command.includes("my-deploy")) {
    const env = command.includes("production") ? "production" : "staging";
    if (command.includes("--json")) {
      return { content: JSON.stringify(mockDeployJSON(env)) };
    }
    return { content: mockDeployHuman(env) };
  }
  return { content: `command not found: ${command}`, isError: true };
}

// ─── Agent Loop (simplified) ────────────────────────────────────────────────

async function runAgent(
  prompt: string,
  model: ReturnType<typeof createScriptedModel>,
): Promise<string[]> {
  const messages: Message[] = [{ role: "user", content: prompt, timestamp: Date.now() }];
  const toolOutputs: string[] = [];

  for (let i = 0; i < 5; i++) {
    const ctx: Context = { systemPrompt: "", messages, tools: [] };
    const stream = model.next(ctx);
    for await (const _ of stream) {}
    const reply = stream.result();
    messages.push(reply);

    const toolCalls = reply.content?.filter((c: any) => c.type === "toolCall") ?? [];
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      const result = executeBash(tc.arguments?.command ?? "");
      toolOutputs.push(`$ ${tc.arguments?.command}\n${result.content}`);
      messages.push({ role: "toolResult", toolCallId: tc.id, toolName: tc.name, content: [{ type: "text", text: result.content }], isError: result.isError ?? false, timestamp: Date.now() } as any);
    }
  }
  return toolOutputs;
}

// ─── 场景演示 ────────────────────────────────────────────────────────────────

console.log("\x1b[36m第 20 章 Demo：CLI 工具扩展\x1b[0m");
console.log("\x1b[90mAgent 最自然的能力接口\x1b[0m\n");

// ─── 场景 1：Agent 友好 vs 人类友好输出对比 ───
{
  console.log("\x1b[33m═══ 场景 1：Agent 友好的 CLI 输出 ═══\x1b[0m");
  console.log("\x1b[90m同一个 CLI，两种输出模式\x1b[0m\n");

  console.log("  \x1b[34m[人类友好输出] my-deploy staging\x1b[0m");
  const humanOut = mockDeployHuman("staging");
  for (const line of humanOut.split("\n")) {
    console.log(`  ${line}`);
  }

  console.log();
  console.log("  \x1b[34m[Agent 友好输出] my-deploy staging --json\x1b[0m");
  const jsonOut = mockDeployJSON("staging");
  console.log(`  ${JSON.stringify(jsonOut, null, 2).split("\n").join("\n  ")}`);

  console.log();
  console.log("  \x1b[32m→ --json 让 Agent 直接解析结构化数据，无需正则提取\x1b[0m");
  console.log("  \x1b[32m→ 退出码让 Agent 快速判断成败，无需理解自然语言\x1b[0m\n");
}

// ─── 场景 2：工具发现 — 读取工具清单 ───
{
  console.log("\x1b[33m═══ 场景 2：工具发现 — 读取工具清单 ═══\x1b[0m");
  console.log("\x1b[90mAgent 通过 tool-manifest.json 发现可用 CLI\x1b[0m\n");

  console.log("  \x1b[34m[tool-manifest.json 结构]\x1b[0m");
  console.log(`  工具数量: ${TOOL_MANIFEST.tools.length}`);
  for (const tool of TOOL_MANIFEST.tools) {
    console.log(`  ├─ ${tool.name}: ${tool.description}`);
    console.log(`  │  usage: ${tool.usage}`);
    console.log(`  │  flags: ${Object.keys(tool.flags).join(", ")}`);
  }

  console.log();
  console.log("  \x1b[32m→ Agent 读取清单后知道：有哪些工具、怎么用、输出格式\x1b[0m");
  console.log("  \x1b[32m→ 无需 --help 试探，一次读取全部信息\x1b[0m\n");
}

// ─── 场景 3：Agent 调用 CLI 并解析结果 ───
{
  console.log("\x1b[33m═══ 场景 3：Agent 通过 bash 调用 CLI 并解析结果 ═══\x1b[0m");
  console.log("\x1b[90m模拟 Agent 完整工作流：发现 → 调用 → 解析\x1b[0m\n");

  // Agent 先读取清单，再调用部署
  const model = createScriptedModel([
    // Step 1: 读取工具清单
    { content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "cat tool-manifest.json" } }], stopReason: "toolUse", role: "assistant", timestamp: Date.now() } as any,
    // Step 2: 调用部署（用 --json）
    { content: [{ type: "toolCall", id: "t2", name: "bash", arguments: { command: "my-deploy staging --json" } }], stopReason: "toolUse", role: "assistant", timestamp: Date.now() } as any,
    // Step 3: 完成
    { content: [{ type: "text", text: "部署完成！staging 环境已更新到 v2.4.1。" }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
  ]);

  const outputs = await runAgent("部署应用到 staging 环境", model);

  console.log("  \x1b[34m[Agent 执行步骤]\x1b[0m");
  outputs.forEach((out, i) => {
    const lines = out.split("\n");
    console.log(`  Step ${i + 1}: \x1b[90m${lines[0]}\x1b[0m`);
    // 只显示部分输出
    const content = lines.slice(1).join("\n");
    if (content.length > 100) {
      console.log(`         \x1b[90m(${content.length} chars JSON output)\x1b[0m`);
    } else {
      console.log(`         ${content.substring(0, 80)}`);
    }
  });

  // 演示 Agent 解析 JSON
  const deployResult: DeployResult = JSON.parse(executeBash("my-deploy staging --json").content);
  console.log();
  console.log("  \x1b[34m[Agent 解析结果]\x1b[0m");
  console.log(`  status: ${deployResult.status}`);
  console.log(`  url:    ${deployResult.url}`);
  console.log(`  time:   ${deployResult.duration_ms}ms`);
  console.log();
  console.log("  \x1b[32m→ Agent 用 bash 工具 + --json 标志 = 万能工具调用\x1b[0m");
  console.log("  \x1b[32m→ 任何 CLI 加上 --json 就变成了 Agent 可用的工具\x1b[0m\n");
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\x1b[33m═══ CLI 工具设计清单 ═══\x1b[0m\n");
console.log("  Agent 友好的 CLI 四要素:");
console.log("  ─────────────────────────────────────");
console.log("  1. --json 标志     →  结构化输出，无需正则解析");
console.log("  2. 退出码语义化    →  0=成功, 非0=失败类型");
console.log("  3. --help 输出     →  Agent 可读的用法说明");
console.log("  4. 非交互式        →  无 prompt/confirm，flag 传入所有参数");
console.log();
console.log("  工具清单 (tool-manifest.json):");
console.log("  ─────────────────────────────────────");
console.log("  • 一次读取全部可用工具");
console.log("  • 包含用法、参数、示例");
console.log("  • 类似 MCP 但零依赖 — 只需 bash + JSON");
console.log();
console.log("\x1b[90m关键认知：bash + JSON = Agent 最通用的工具协议。\x1b[0m");
console.log("\x1b[90m任何现有 CLI 加 --json 就变成 Agent 工具，无需改造。\x1b[0m\n");
