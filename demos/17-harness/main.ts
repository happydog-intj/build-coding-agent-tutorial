/**
 * 第 17 章：Harness 工程 — 模型不可靠时的工程补救
 *
 * 用 ScriptedModel 模拟四种故障场景，演示 Harness 如何防护：
 * 1. 死循环（同一工具无限调用）→ Max Iterations 截断
 * 2. 连续失败（重复犯错）→ 注入策略切换提示
 * 3. 过早终止（说完了但没做）→ 输出验证 + 自动重试
 * 4. Proposer-Reviewer（交叉验证高风险操作）
 *
 * 无需 API key！
 *
 * 运行方式：
 *   npx tsx main.ts
 */

import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AssistantMessage, AssistantMessageEventStream, Context, Message, Tool } from "@earendil-works/pi-ai";

// ─── ScriptedModel ──────────────────────────────────────────────────────────
function createScriptedModel(responses: AssistantMessage[]) {
  let cursor = 0;
  return {
    get callCount() { return cursor; },
    next(ctx: Context): AssistantMessageEventStream {
      if (cursor >= responses.length) cursor = responses.length - 1; // repeat last
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

// ─── Mini Tools ─────────────────────────────────────────────────────────────
interface ToolResult { content: string; isError?: boolean; }

const tools = [
  { name: "read_file", execute: async (p: any): Promise<ToolResult> => {
    try { return { content: readFileSync(p.path, "utf-8") }; }
    catch { return { content: "File not found", isError: true }; }
  }},
  { name: "write_file", execute: async (p: any): Promise<ToolResult> => {
    writeFileSync(p.path, p.content); return { content: `Wrote ${p.path}` };
  }},
];

// ─── Harness-Enhanced Agent Loop ────────────────────────────────────────────

interface HarnessConfig {
  maxIterations: number;
  maxConsecutiveErrors: number;
  verifier?: () => { passed: boolean; reason?: string };
  maxVerifyRetries: number;
}

async function runAgentWithHarness(
  prompt: string,
  messages: Message[],
  streamFn: (ctx: Context) => AssistantMessageEventStream,
  harness: HarnessConfig,
): Promise<{ iterations: number; stoppedBy: string }> {
  messages.push({ role: "user", content: prompt, timestamp: Date.now() });

  let iterations = 0;
  let consecutiveErrors = 0;
  let stoppedBy = "natural";

  while (true) {
    iterations++;

    // ─── Harness: Max Iterations ───
    if (iterations > harness.maxIterations) {
      stoppedBy = "max_iterations";
      break;
    }

    const context: Context = { systemPrompt: "You are a coding assistant.", messages, tools: [] };
    const stream = streamFn(context);
    for await (const _ of stream) {}
    const reply = stream.result();
    messages.push(reply);

    if (reply.stopReason === "error") { stoppedBy = "error"; break; }

    const toolCalls = reply.content?.filter((c: any) => c.type === "toolCall") ?? [];
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      const tool = tools.find(t => t.name === tc.name);
      let result: ToolResult;
      if (!tool) { result = { content: `Unknown tool: ${tc.name}`, isError: true }; }
      else { try { result = await tool.execute(tc.arguments); } catch (e: any) { result = { content: e.message, isError: true }; } }

      // ─── Harness: Consecutive Error Detection ───
      if (result.isError) {
        consecutiveErrors++;
        if (consecutiveErrors >= harness.maxConsecutiveErrors) {
          messages.push({
            role: "user",
            content: `⚠️ ${consecutiveErrors} consecutive failures. Try a different approach.`,
            timestamp: Date.now(),
          } as any);
          consecutiveErrors = 0;
          stoppedBy = "consecutive_errors_intervention";
        }
      } else {
        consecutiveErrors = 0;
      }

      messages.push({ role: "toolResult", toolCallId: tc.id, toolName: tc.name, content: [{ type: "text", text: result.content }], isError: result.isError ?? false, timestamp: Date.now() } as any);
    }
  }

  return { iterations, stoppedBy };
}

// ─── Harness: Verification Wrapper ─────────────────────────────────────────

async function runWithVerification(
  prompt: string,
  streamFn: (ctx: Context) => AssistantMessageEventStream,
  harness: HarnessConfig,
): Promise<{ attempts: number; verified: boolean; stoppedBy: string }> {
  const messages: Message[] = [];
  let attempts = 0;

  for (let i = 0; i <= harness.maxVerifyRetries; i++) {
    attempts++;
    const effectivePrompt = i === 0 ? prompt : `Verification failed: ${harness.verifier!().reason}\nPlease fix this.`;
    const result = await runAgentWithHarness(effectivePrompt, messages, streamFn, harness);

    if (!harness.verifier) return { attempts, verified: true, stoppedBy: result.stoppedBy };

    const check = harness.verifier();
    if (check.passed) return { attempts, verified: true, stoppedBy: "verified" };
  }

  return { attempts, verified: false, stoppedBy: "verification_exhausted" };
}

// ─── 场景演示 ────────────────────────────────────────────────────────────────

console.log("\x1b[36m第 17 章 Demo：Harness 工程\x1b[0m");
console.log("\x1b[90m模型不可靠时的四道防线\x1b[0m\n");

// ─── Scenario 1: 死循环 → Max Iterations 截断 ───
{
  console.log("\x1b[33m═══ 场景 1：死循环 → Max Iterations ═══\x1b[0m");
  console.log("\x1b[90m模型无限调用 read_file（模拟 bug）\x1b[0m\n");

  // 模型每次都调用 read_file，永不终止
  const loopingModel = createScriptedModel([
    { content: [{ type: "toolCall", id: "t1", name: "read_file", arguments: { path: "x.txt" } }], stopReason: "toolUse", role: "assistant", timestamp: Date.now() } as any,
  ]);

  const tmpDir = mkdtempSync(join(tmpdir(), "h-")); process.chdir(tmpDir);
  writeFileSync("x.txt", "data");

  const result = await runAgentWithHarness("read x.txt", [], (ctx) => loopingModel.next(ctx), {
    maxIterations: 5, maxConsecutiveErrors: 10, maxVerifyRetries: 0,
  });

  console.log(`  iterations: ${result.iterations}`);
  console.log(`  \x1b[32mstopped by: ${result.stoppedBy}\x1b[0m`);
  console.log(`  → Max Iterations 防止了无限循环（限制=5，实际跑了 ${result.iterations} 轮）\n`);
  process.chdir("/"); rmSync(tmpDir, { recursive: true, force: true });
}

// ─── Scenario 2: 连续失败 → 策略切换提示 ───
{
  console.log("\x1b[33m═══ 场景 2：连续失败 → 策略切换 ═══\x1b[0m");
  console.log("\x1b[90m模型连续 3 次读不存在的文件\x1b[0m\n");

  const failingModel = createScriptedModel([
    { content: [{ type: "toolCall", id: "t1", name: "read_file", arguments: { path: "nope1.txt" } }], stopReason: "toolUse", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "toolCall", id: "t2", name: "read_file", arguments: { path: "nope2.txt" } }], stopReason: "toolUse", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "toolCall", id: "t3", name: "read_file", arguments: { path: "nope3.txt" } }], stopReason: "toolUse", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "text", text: "I'll try a different approach." }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
  ]);

  const tmpDir = mkdtempSync(join(tmpdir(), "h-")); process.chdir(tmpDir);
  const msgs: Message[] = [];
  const result = await runAgentWithHarness("find data", msgs, (ctx) => failingModel.next(ctx), {
    maxIterations: 10, maxConsecutiveErrors: 3, maxVerifyRetries: 0,
  });

  const intervention = msgs.find((m: any) => m.role === "user" && typeof m.content === "string" && m.content.includes("consecutive failures"));
  console.log(`  stopped by: ${result.stoppedBy}`);
  console.log(`  \x1b[32mintervention injected: ${!!intervention}\x1b[0m`);
  console.log(`  → 连续 3 次失败后注入提示，让模型换策略\n`);
  process.chdir("/"); rmSync(tmpDir, { recursive: true, force: true });
}

// ─── Scenario 3: 过早终止 → 验证 + 重试 ───
{
  console.log("\x1b[33m═══ 场景 3：过早终止 → 输出验证 + 重试 ═══\x1b[0m");
  console.log("\x1b[90m模型第一次说完成了但没创建文件，验证失败后重试\x1b[0m\n");

  let callCount = 0;
  const lazyThenFixModel = createScriptedModel([
    // 第一次：直接说完成了（没有调工具）
    { content: [{ type: "text", text: "Done! File created." }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
    // 第二次（重试后）：真的创建文件
    { content: [{ type: "toolCall", id: "t1", name: "write_file", arguments: { path: "hello.txt", content: "Hello, World!" } }], stopReason: "toolUse", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "text", text: "File created successfully." }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
  ]);

  const tmpDir = mkdtempSync(join(tmpdir(), "h-")); process.chdir(tmpDir);

  const result = await runWithVerification(
    "Create hello.txt with content 'Hello, World!'",
    (ctx) => lazyThenFixModel.next(ctx),
    {
      maxIterations: 10, maxConsecutiveErrors: 5, maxVerifyRetries: 2,
      verifier: () => {
        if (!existsSync("hello.txt")) return { passed: false, reason: "hello.txt does not exist" };
        const content = readFileSync("hello.txt", "utf-8").trim();
        if (content !== "Hello, World!") return { passed: false, reason: `Content is "${content}", expected "Hello, World!"` };
        return { passed: true };
      },
    },
  );

  console.log(`  attempts: ${result.attempts}`);
  console.log(`  verified: ${result.verified}`);
  console.log(`  \x1b[32mstopped by: ${result.stoppedBy}\x1b[0m`);
  console.log(`  → 第一次过早终止被验证器抓住，第二次重试后通过\n`);
  process.chdir("/"); rmSync(tmpDir, { recursive: true, force: true });
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\x1b[33m═══ Harness 防护总结 ═══\x1b[0m\n");
console.log("  故障模式              →  防护手段");
console.log("  ─────────────────────────────────────");
console.log("  无限循环              →  Max Iterations");
console.log("  重复犯同样错误        →  连续失败检测 + 策略切换提示");
console.log("  过早终止              →  输出验证 + 自动重试");
console.log("  高风险操作不审慎      →  Proposer-Reviewer 交叉验证");
console.log();
console.log("\x1b[90m关键认知：模型不可靠是常态。好的 Agent 在模型之外建立工程保障。\x1b[0m\n");
