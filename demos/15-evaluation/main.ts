/**
 * 第 15 章：评测 — 证明你的 Agent 能工作
 *
 * 两层自动化评测：
 * 1. 逻辑评测（ScriptedModel，无需 API key）— 验证 Agent Loop 行为
 * 2. 能力评测（真实模型，需要 API key）— 验证 Agent 完成实际任务
 *
 * 每个 EvalCase = prepare() → Agent 执行 prompt → verify()
 * Runner 在隔离临时目录中运行每个用例，互不干扰。
 *
 * 运行方式：
 *   npx tsx main.ts              # 运行全部（逻辑层不需要 key）
 *   npx tsx main.ts --logic      # 只跑逻辑评测（无需 API key）
 *   npx tsx main.ts --capability # 只跑能力评测（需要 API key）
 */

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { exec } from "node:child_process";
import type { AssistantMessage, AssistantMessageEventStream, Context, Message, Tool } from "@earendil-works/pi-ai";

// ─── EvalCase 类型 ──────────────────────────────────────────────────────────────
interface EvalCase {
  name: string;
  prompt: string;
  prepare: () => void;
  verify: () => boolean;
}

interface EvalResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

// ─── ScriptedModel（录播模型，无需 API key）──────────────────────────────────────
function createScriptedModel(responses: AssistantMessage[]) {
  let cursor = 0;
  const calls: Context[] = [];

  return {
    get callCount() { return calls.length; },
    get calls() { return calls; },

    next(ctx: Context): AssistantMessageEventStream {
      calls.push(structuredClone(ctx));
      if (cursor >= responses.length) {
        throw new Error(`ScriptedModel exhausted: called ${cursor + 1} times, only ${responses.length} responses`);
      }
      const response = responses[cursor++];
      const events: any[] = [];
      for (const block of response.content) {
        if (block.type === "text") events.push({ type: "text_delta", delta: block.text });
      }

      let resolved = false;
      const stream: AssistantMessageEventStream = {
        [Symbol.asyncIterator]() {
          let i = 0;
          return { async next() { return i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true }; } };
        },
        result() {
          resolved = true;
          return response;
        },
      } as any;
      return stream;
    },
  };
}

// ─── Mini Tool 定义 ─────────────────────────────────────────────────────────────
interface ToolResult { content: string; isError?: boolean; }
interface MiniTool { name: string; description: string; parameters: object; execute: (p: any) => Promise<ToolResult>; }

const allTools: MiniTool[] = [
  {
    name: "read_file", description: "Read file.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    async execute(p) {
      try { return { content: readFileSync(resolve(p.path), "utf-8") }; }
      catch (e: any) { return { content: e.message, isError: true }; }
    },
  },
  {
    name: "write_file", description: "Write file.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    async execute(p) {
      try {
        const dir = dirname(resolve(p.path));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(p.path), p.content);
        return { content: `Wrote ${p.path}` };
      } catch (e: any) { return { content: e.message, isError: true }; }
    },
  },
  {
    name: "bash", description: "Run command.",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    async execute(p) {
      return new Promise(res => {
        exec(p.command, { timeout: 10_000 }, (err, stdout, stderr) => {
          if (err?.killed) { res({ content: "Timed out", isError: true }); return; }
          res({ content: (stdout + stderr).slice(0, 3000) || "(no output)", isError: err !== null });
        });
      });
    },
  },
];

// ─── Agent Loop（精简版，用于评测）─────────────────────────────────────────────
interface AgentConfig {
  streamFn: (ctx: Context) => AssistantMessageEventStream;
  tools: MiniTool[];
  systemPrompt: string;
}

async function runAgent(prompt: string, messages: Message[], config: AgentConfig): Promise<void> {
  messages.push({ role: "user", content: prompt, timestamp: Date.now() });

  const toolSchemas: Tool[] = config.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters as any }));

  while (true) {
    const context: Context = { systemPrompt: config.systemPrompt, messages, tools: toolSchemas };
    const stream = config.streamFn(context);
    for await (const _ of stream) { /* consume */ }
    const reply = stream.result();
    messages.push(reply);

    if (reply.stopReason === "error" || reply.stopReason === "aborted") break;

    const toolCalls = reply.content?.filter((c): c is any => c.type === "toolCall") ?? [];
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      const tool = config.tools.find(t => t.name === tc.name);
      let result: ToolResult;
      if (!tool) { result = { content: `Unknown tool: ${tc.name}`, isError: true }; }
      else { try { result = await tool.execute(tc.arguments); } catch (e: any) { result = { content: e.message, isError: true }; } }

      messages.push({
        role: "toolResult", toolCallId: tc.id, toolName: tc.name,
        content: [{ type: "text", text: result.content }],
        isError: result.isError ?? false, timestamp: Date.now(),
      } as any);
    }
  }
}

// ─── Eval Runner（隔离执行每个用例）──────────────────────────────────────────────
async function runEval(cases: EvalCase[], config: AgentConfig): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const evalCase of cases) {
    const tmpDir = mkdtempSync(join(tmpdir(), "eval-"));
    const originalDir = process.cwd();
    process.chdir(tmpDir);

    const start = Date.now();
    let passed = false;
    let error: string | undefined;

    try {
      evalCase.prepare();
      const messages: Message[] = [];
      await runAgent(evalCase.prompt, messages, config);
      passed = evalCase.verify();
    } catch (err: any) {
      error = err.message;
      passed = false;
    } finally {
      process.chdir(originalDir);
      rmSync(tmpDir, { recursive: true, force: true });
    }

    results.push({ name: evalCase.name, passed, error, durationMs: Date.now() - start });
  }
  return results;
}

// ─── 报告输出 ────────────────────────────────────────────────────────────────────

function printReport(title: string, results: EvalResult[]): void {
  console.log(`\n\x1b[36m═══ ${title} ═══\x1b[0m\n`);

  for (const r of results) {
    const icon = r.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const time = `\x1b[90m(${r.durationMs}ms)\x1b[0m`;
    console.log(`  ${icon} ${r.name} ${time}`);
    if (r.error) console.log(`    \x1b[31m${r.error}\x1b[0m`);
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const color = passed === total ? "\x1b[32m" : "\x1b[31m";
  console.log(`\n${color}${passed}/${total} passed\x1b[0m`);
}

// ─── 第一层：逻辑评测（ScriptedModel，无需 API key）─────────────────────────────

async function runLogicEval(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  // Case 1: terminates-without-tool-calls
  {
    const model = createScriptedModel([{
      content: [{ type: "text", text: "Hello!" }], stopReason: "endTurn", timestamp: Date.now(), role: "assistant",
    } as any]);
    const config: AgentConfig = { streamFn: (ctx) => model.next(ctx), tools: allTools, systemPrompt: "test" };
    const tmpDir = mkdtempSync(join(tmpdir(), "eval-")); const orig = process.cwd(); process.chdir(tmpDir);
    const start = Date.now();
    try {
      const msgs: Message[] = [];
      await runAgent("Hi", msgs, config);
      results.push({ name: "terminates-without-tool-calls", passed: model.callCount === 1, durationMs: Date.now() - start });
    } catch (e: any) { results.push({ name: "terminates-without-tool-calls", passed: false, error: e.message, durationMs: Date.now() - start }); }
    finally { process.chdir(orig); rmSync(tmpDir, { recursive: true, force: true }); }
  }

  // Case 2: executes-tool-and-pairs-result
  {
    const model = createScriptedModel([
      { content: [{ type: "toolCall", id: "tc_001", name: "read_file", arguments: { path: "test.txt" } }], stopReason: "toolUse", timestamp: Date.now(), role: "assistant" } as any,
      { content: [{ type: "text", text: "Done" }], stopReason: "endTurn", timestamp: Date.now(), role: "assistant" } as any,
    ]);
    const config: AgentConfig = { streamFn: (ctx) => model.next(ctx), tools: allTools, systemPrompt: "test" };
    const tmpDir = mkdtempSync(join(tmpdir(), "eval-")); const orig = process.cwd(); process.chdir(tmpDir);
    const start = Date.now();
    try {
      writeFileSync("test.txt", "hello");
      const msgs: Message[] = [];
      await runAgent("Read test.txt", msgs, config);
      const tr = msgs.find((m: any) => m.role === "toolResult") as any;
      const passed = tr?.toolCallId === "tc_001" && tr?.toolName === "read_file" && !tr?.isError;
      results.push({ name: "executes-tool-and-pairs-result", passed, durationMs: Date.now() - start });
    } catch (e: any) { results.push({ name: "executes-tool-and-pairs-result", passed: false, error: e.message, durationMs: Date.now() - start }); }
    finally { process.chdir(orig); rmSync(tmpDir, { recursive: true, force: true }); }
  }

  // Case 3: sets-isError-on-failure
  {
    const model = createScriptedModel([
      { content: [{ type: "toolCall", id: "tc_002", name: "read_file", arguments: { path: "no-such-file.txt" } }], stopReason: "toolUse", timestamp: Date.now(), role: "assistant" } as any,
      { content: [{ type: "text", text: "Not found" }], stopReason: "endTurn", timestamp: Date.now(), role: "assistant" } as any,
    ]);
    const config: AgentConfig = { streamFn: (ctx) => model.next(ctx), tools: allTools, systemPrompt: "test" };
    const tmpDir = mkdtempSync(join(tmpdir(), "eval-")); const orig = process.cwd(); process.chdir(tmpDir);
    const start = Date.now();
    try {
      const msgs: Message[] = [];
      await runAgent("Read no-such-file.txt", msgs, config);
      const tr = msgs.find((m: any) => m.role === "toolResult") as any;
      results.push({ name: "sets-isError-on-failure", passed: tr?.isError === true, durationMs: Date.now() - start });
    } catch (e: any) { results.push({ name: "sets-isError-on-failure", passed: false, error: e.message, durationMs: Date.now() - start }); }
    finally { process.chdir(orig); rmSync(tmpDir, { recursive: true, force: true }); }
  }

  // Case 4: handles-unknown-tool
  {
    const model = createScriptedModel([
      { content: [{ type: "toolCall", id: "tc_003", name: "unknown_tool", arguments: {} }], stopReason: "toolUse", timestamp: Date.now(), role: "assistant" } as any,
      { content: [{ type: "text", text: "Sorry" }], stopReason: "endTurn", timestamp: Date.now(), role: "assistant" } as any,
    ]);
    const config: AgentConfig = { streamFn: (ctx) => model.next(ctx), tools: allTools, systemPrompt: "test" };
    const tmpDir = mkdtempSync(join(tmpdir(), "eval-")); const orig = process.cwd(); process.chdir(tmpDir);
    const start = Date.now();
    try {
      const msgs: Message[] = [];
      await runAgent("Do something", msgs, config);
      const tr = msgs.find((m: any) => m.role === "toolResult") as any;
      const passed = tr?.isError === true && tr?.content?.[0]?.text?.includes("Unknown tool");
      results.push({ name: "handles-unknown-tool", passed, durationMs: Date.now() - start });
    } catch (e: any) { results.push({ name: "handles-unknown-tool", passed: false, error: e.message, durationMs: Date.now() - start }); }
    finally { process.chdir(orig); rmSync(tmpDir, { recursive: true, force: true }); }
  }

  return results;
}

// ─── 第二层：能力评测（真实模型，需要 API key）───────────────────────────────────
function buildCapabilityCases(): EvalCase[] {
  return [
    {
      name: "create-file-with-content",
      prompt: "Create a file called hello.txt with the content 'Hello, World!'",
      prepare: () => {},
      verify: () => {
        if (!existsSync("hello.txt")) return false;
        return readFileSync("hello.txt", "utf-8").trim() === "Hello, World!";
      },
    },
    {
      name: "read-and-answer",
      prompt: "Read data.txt and tell me how many lines it has. Write the answer as just a number to answer.txt",
      prepare: () => {
        writeFileSync("data.txt", "line1\nline2\nline3\nline4\nline5\n");
      },
      verify: () => {
        if (!existsSync("answer.txt")) return false;
        const answer = readFileSync("answer.txt", "utf-8").trim();
        return answer.includes("5");
      },
    },
    {
      name: "fix-syntax-error",
      prompt: "Fix the syntax error in broken.js so it runs without errors.",
      prepare: () => {
        writeFileSync("broken.js", `
function greet(name) {
  console.log("Hello, " + name)
  // missing closing brace

greet("world");
`);
      },
      verify: () => {
        if (!existsSync("broken.js")) return false;
        try {
          execSync("node --check broken.js", { encoding: "utf-8" });
          return true;
        } catch { return false; }
      },
    },
  ];
}

async function runCapabilityEval(): Promise<EvalResult[]> {
  const { builtinModels, getBuiltinModel } = await import("@earendil-works/pi-ai/providers/all");
  const models = builtinModels();

  let model: any;
  if (process.env.ANTHROPIC_API_KEY) {
    model = getBuiltinModel("anthropic", "claude-sonnet-4-20250514");
  } else if (process.env.OPENAI_API_KEY) {
    model = getBuiltinModel("openai", "gpt-4o");
  } else {
    console.log("\x1b[33m⚠ 跳过能力评测：未设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY\x1b[0m");
    return [];
  }

  const config: AgentConfig = {
    streamFn: (ctx) => models.streamSimple(model, ctx),
    tools: allTools,
    systemPrompt: `You are a coding assistant. Tools: read_file, write_file, bash.\nCurrent directory: use relative paths.\nBe concise. Complete the task silently.`,
  };

  return runEval(buildCapabilityCases(), config);
}

// ─── Main ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const runLogic = args.includes("--logic") || args.length === 0;
const runCapability = args.includes("--capability") || args.length === 0;

console.log("\x1b[36m第 15 章 Demo：Evaluation — 自动化评测\x1b[0m");
console.log("\x1b[90m验证 Agent 行为的两层测试体系\x1b[0m\n");

let allPassed = true;

if (runLogic) {
  console.log("\x1b[90m▶ 第一层：逻辑评测（ScriptedModel，无需 API key）\x1b[0m");
  const logicResults = await runLogicEval();
  printReport("逻辑评测 (Agent Loop 行为)", logicResults);
  if (logicResults.some(r => !r.passed)) allPassed = false;
}

if (runCapability) {
  console.log("\n\x1b[90m▶ 第二层：能力评测（真实模型）\x1b[0m");
  const capResults = await runCapabilityEval();
  if (capResults.length > 0) {
    printReport("能力评测 (Agent 实际任务)", capResults);
    if (capResults.some(r => !r.passed)) allPassed = false;
  }
}

console.log();
process.exit(allPassed ? 0 : 1);
