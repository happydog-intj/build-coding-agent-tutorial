/**
 * 第 21 章：并行执行与成本控制
 * 演示 Semaphore 并发、超时处理、Token 追踪、Budget 守卫
 * 无需 API key！运行：npx tsx main.ts
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

// ─── Semaphore ──────────────────────────────────────────────────────────────
class Semaphore {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private concurrency: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.concurrency) { this.running++; return; }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) { this.running++; next(); }
  }
}

// ─── Parallel Tool Execution ────────────────────────────────────────────────

interface ToolCall { id: string; name: string; durationMs: number; }
interface ToolExecResult { id: string; name: string; result: string; durationMs: number; status: "fulfilled" | "rejected"; }

async function simulateTool(tc: ToolCall, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(`${tc.name} completed`), tc.durationMs);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error(`${tc.name} timed out`)); });
  });
}

async function executeToolsParallel(
  calls: ToolCall[], sem: Semaphore, timeoutMs?: number,
): Promise<ToolExecResult[]> {
  const results = await Promise.allSettled(
    calls.map(async (tc) => {
      await sem.acquire();
      try {
        const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
        const start = Date.now();
        const result = await simulateTool(tc, signal);
        return { id: tc.id, name: tc.name, result, durationMs: Date.now() - start, status: "fulfilled" as const };
      } finally { sem.release(); }
    }),
  );
  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value :
    { id: calls[i].id, name: calls[i].name, result: (r.reason as Error).message, durationMs: calls[i].durationMs, status: "rejected" as const }
  );
}

async function executeToolsSerial(calls: ToolCall[]): Promise<{ totalMs: number }> {
  const start = Date.now();
  for (const tc of calls) { await simulateTool(tc); }
  return { totalMs: Date.now() - start };
}

// ─── Token Tracker ──────────────────────────────────────────────────────────

interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number; }

class TokenTracker {
  private calls: { label: string; usage: TokenUsage }[] = [];

  record(label: string, usage: TokenUsage): void { this.calls.push({ label, usage }); }

  get total(): TokenUsage {
    return this.calls.reduce((acc, c) => ({
      input: acc.input + c.usage.input,
      output: acc.output + c.usage.output,
      cacheRead: acc.cacheRead + c.usage.cacheRead,
      cacheWrite: acc.cacheWrite + c.usage.cacheWrite,
    }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  }

  get totalTokens(): number { const t = this.total; return t.input + t.output + t.cacheRead + t.cacheWrite; }
  get callCount(): number { return this.calls.length; }
  get history() { return this.calls; }
}

// ─── Agent Loop with Budget ─────────────────────────────────────────────────

interface BudgetConfig { maxTokens: number; }

async function runAgentWithBudget(
  model: ReturnType<typeof createScriptedModel>,
  tracker: TokenTracker,
  budget: BudgetConfig,
  tools: ToolCall[][],  // each iteration's tool calls
): Promise<{ iterations: number; stoppedBy: string }> {
  let iterations = 0;
  const mockUsagePerCall: TokenUsage = { input: 2000, output: 500, cacheRead: 800, cacheWrite: 200 };

  for (const iterTools of tools) {
    iterations++;
    // Simulate model call
    tracker.record(`iteration-${iterations}`, mockUsagePerCall);

    // Budget check
    if (tracker.totalTokens >= budget.maxTokens) {
      return { iterations, stoppedBy: "budget_exceeded" };
    }

    // Execute tools (parallel)
    const sem = new Semaphore(3);
    await executeToolsParallel(iterTools, sem);
  }
  return { iterations, stoppedBy: "natural" };
}

// ─── 场景演示 ────────────────────────────────────────────────────────────────

console.log("\x1b[36m第 21 章 Demo：并行执行与成本控制\x1b[0m");
console.log("\x1b[90m高效执行 + 预算管理\x1b[0m\n");

// ─── 场景 1：并行 vs 串行时间对比 ───
{
  console.log("\x1b[33m═══ 场景 1：并行 vs 串行执行时间对比 ═══\x1b[0m");
  console.log("\x1b[90m5 个工具各耗时 100ms，并发度=3\x1b[0m\n");

  const calls: ToolCall[] = [
    { id: "t1", name: "read_file_a", durationMs: 100 },
    { id: "t2", name: "read_file_b", durationMs: 100 },
    { id: "t3", name: "read_file_c", durationMs: 100 },
    { id: "t4", name: "grep_code", durationMs: 100 },
    { id: "t5", name: "list_dir", durationMs: 100 },
  ];

  // 串行
  const serialStart = Date.now();
  const serialResult = await executeToolsSerial(calls);
  const serialTime = Date.now() - serialStart;

  // 并行（concurrency=3）
  const sem = new Semaphore(3);
  const parallelStart = Date.now();
  const parallelResults = await executeToolsParallel(calls, sem);
  const parallelTime = Date.now() - parallelStart;

  console.log(`  串行执行: ${serialTime}ms (5 × 100ms ≈ 500ms)`);
  console.log(`  并行执行: ${parallelTime}ms (concurrency=3 → ceil(5/3)×100ms ≈ 200ms)`);
  console.log(`  \x1b[32m加速比: ${(serialTime / Math.max(parallelTime, 1)).toFixed(1)}x\x1b[0m`);
  console.log();
  console.log("  Semaphore 工作原理:");
  console.log("  ┌──────────────────────────────────────┐");
  console.log("  │  t=0ms   [t1] [t2] [t3]  running     │");
  console.log("  │  t=100ms [t4] [t5]  ──   2nd batch   │");
  console.log("  │  t=200ms  done                        │");
  console.log("  └──────────────────────────────────────┘\n");
}

// ─── 场景 2：超时处理 ───
{
  console.log("\x1b[33m═══ 场景 2：超时处理 — 慢工具被取消 ═══\x1b[0m");
  console.log("\x1b[90m超时=150ms，一个工具耗时 300ms\x1b[0m\n");

  const calls: ToolCall[] = [
    { id: "t1", name: "fast_tool", durationMs: 50 },
    { id: "t2", name: "normal_tool", durationMs: 100 },
    { id: "t3", name: "slow_tool", durationMs: 300 },  // will timeout
  ];

  const sem = new Semaphore(3);
  const results = await executeToolsParallel(calls, sem, 150);

  for (const r of results) {
    const icon = r.status === "fulfilled" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${icon} ${r.name.padEnd(14)} ${r.status.padEnd(10)} ${r.result}`);
  }

  console.log();
  console.log("  \x1b[32m→ AbortSignal.timeout(150) 取消了 slow_tool\x1b[0m");
  console.log("  \x1b[32m→ 快工具不受影响，结果通过 Promise.allSettled 收集\x1b[0m\n");
}

// ─── 场景 3：Token 用量追踪 ───
{
  console.log("\x1b[33m═══ 场景 3：Token 用量追踪 ═══\x1b[0m");
  console.log("\x1b[90m逐次记录 input/output/cache tokens\x1b[0m\n");

  const tracker = new TokenTracker();
  tracker.record("call-1 (initial)", { input: 1500, output: 400, cacheRead: 0, cacheWrite: 1200 });
  tracker.record("call-2 (tool results)", { input: 2800, output: 300, cacheRead: 1200, cacheWrite: 0 });
  tracker.record("call-3 (final)", { input: 3200, output: 600, cacheRead: 1200, cacheWrite: 0 });

  console.log("  \x1b[34m[逐次用量]\x1b[0m");
  for (const c of tracker.history) {
    const u = c.usage;
    console.log(`  ${c.label.padEnd(22)} in:${String(u.input).padStart(5)} out:${String(u.output).padStart(4)} cache_r:${String(u.cacheRead).padStart(5)} cache_w:${String(u.cacheWrite).padStart(5)}`);
  }

  const total = tracker.total;
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log(`  ${"TOTAL".padEnd(22)} in:${String(total.input).padStart(5)} out:${String(total.output).padStart(4)} cache_r:${String(total.cacheRead).padStart(5)} cache_w:${String(total.cacheWrite).padStart(5)}`);
  console.log(`  总 tokens: ${tracker.totalTokens}  (${tracker.callCount} 次调用)`);

  // 估算成本 (Claude Sonnet 价格近似)
  const cost = (total.input * 3 + total.output * 15 + total.cacheRead * 0.3 + total.cacheWrite * 3.75) / 1_000_000;
  console.log(`  估算成本: $${cost.toFixed(4)} (按 Sonnet 定价)`);
  console.log();
  console.log("  \x1b[32m→ Cache read 比 input 便宜 10x，多轮对话自动受益\x1b[0m\n");
}

// ─── 场景 4：Budget 超限 → 停止 Agent ───
{
  console.log("\x1b[33m═══ 场景 4：Budget 超限 → 停止 Agent ═══\x1b[0m");
  console.log("\x1b[90m预算 8000 tokens，每次调用约 3500 tokens\x1b[0m\n");

  const tracker = new TokenTracker();
  const toolSets: ToolCall[][] = [
    [{ id: "t1", name: "read_a", durationMs: 10 }],
    [{ id: "t2", name: "read_b", durationMs: 10 }],
    [{ id: "t3", name: "read_c", durationMs: 10 }],
    [{ id: "t4", name: "write_d", durationMs: 10 }],
  ];

  const model = createScriptedModel([
    { content: [{ type: "text", text: "" }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "text", text: "" }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "text", text: "" }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "text", text: "" }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
  ]);

  const result = await runAgentWithBudget(model, tracker, { maxTokens: 8000 }, toolSets);

  console.log(`  总预算:   8000 tokens`);
  console.log(`  已用:     ${tracker.totalTokens} tokens (${tracker.callCount} 次调用)`);
  console.log(`  迭代数:   ${result.iterations}`);
  console.log(`  \x1b[32m停止原因: ${result.stoppedBy}\x1b[0m`);
  console.log();
  console.log("  执行时间线:");
  for (let i = 0; i < tracker.callCount; i++) {
    const cumulative = tracker.history.slice(0, i + 1).reduce((s, c) => s + c.usage.input + c.usage.output + c.usage.cacheRead + c.usage.cacheWrite, 0);
    const bar = "█".repeat(Math.round(cumulative / 500));
    const marker = cumulative >= 8000 ? " ← BUDGET EXCEEDED" : "";
    console.log(`  iter ${i + 1}: ${bar} ${cumulative}${marker}`);
  }
  console.log();
  console.log("  \x1b[32m→ 每次 LLM 调用后检查 token 总量\x1b[0m");
  console.log("  \x1b[32m→ 超限时优雅停止，返回已完成的工作\x1b[0m\n");
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log("\x1b[33m═══ 并行执行与成本控制总结 ═══\x1b[0m\n");
console.log("  并行执行  Semaphore + Promise.allSettled");
console.log("  超时控制  AbortSignal.timeout(ms)");
console.log("  Token 追踪  累计 input/output/cache tokens");
console.log("  Budget 守卫  每次 LLM 调用后检查 → 超限停止");
console.log();
console.log("\x1b[90m关键认知：并行执行省时间，Budget 守卫省钱。两者结合才是生产级 Agent。\x1b[0m\n");
