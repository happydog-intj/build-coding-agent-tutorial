/**
 * 第 23 章：多 Agent 协作 — Coordinator + Worker 模式
 *
 * 用 ScriptedModel 模拟多 Agent 协作：
 * 1. SubAgent：独立消息历史、专属 system prompt、隔离执行
 * 2. Coordinator：任务分解 → 分发 → 汇总
 * 3. Workers 并行执行，各自独立上下文
 * 4. 结果汇总合成
 *
 * 场景：Coordinator 收到 "Review this PR" 任务，分解为安全/性能/风格三个子任务，
 * 分发给三个 Worker 并行执行，最后汇总结论。
 *
 * 无需 API key！
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

// ─── SubAgent: Independent Context ──────────────────────────────────────────

interface SubAgent {
  name: string;
  systemPrompt: string;
  messages: Message[];
  model: ReturnType<typeof createScriptedModel>;
}

function createSubAgent(name: string, systemPrompt: string, responses: AssistantMessage[]): SubAgent {
  return { name, systemPrompt, messages: [], model: createScriptedModel(responses) };
}

async function runSubAgent(agent: SubAgent, task: string): Promise<string> {
  // Each SubAgent has its own isolated message history
  agent.messages.push({ role: "user", content: task, timestamp: Date.now() } as any);

  const ctx: Context = { systemPrompt: agent.systemPrompt, messages: agent.messages, tools: [] };
  const stream = agent.model.next(ctx);
  for await (const _ of stream) {}
  const reply = stream.result();

  agent.messages.push(reply);
  return reply.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") ?? "";
}

// ─── Coordinator: Decompose + Dispatch + Synthesize ─────────────────────────

interface TaskDecomposition {
  subtasks: { worker: string; task: string }[];
}

interface WorkerResult {
  worker: string;
  result: string;
  duration: number;
}

async function coordinatorDecompose(coordinator: SubAgent, task: string): Promise<TaskDecomposition> {
  const response = await runSubAgent(coordinator, task);
  // In a real system, the coordinator's response would be parsed as structured output
  // Here we simulate the decomposition result
  return JSON.parse(response);
}

async function dispatchWorkers(workers: SubAgent[], subtasks: TaskDecomposition["subtasks"]): Promise<WorkerResult[]> {
  // Run all workers in parallel — each has independent context
  const startTime = Date.now();
  const promises = subtasks.map(async (st) => {
    const worker = workers.find(w => w.name === st.worker);
    if (!worker) throw new Error(`Worker not found: ${st.worker}`);
    const start = Date.now();
    const result = await runSubAgent(worker, st.task);
    return { worker: st.worker, result, duration: Date.now() - start };
  });

  return Promise.all(promises);
}

async function coordinatorSynthesize(coordinator: SubAgent, results: WorkerResult[]): Promise<string> {
  const synthesis = results.map(r => `[${r.worker}]: ${r.result}`).join("\n");
  return runSubAgent(coordinator, `Synthesize these review results:\n${synthesis}`);
}

// ─── Demo Execution ─────────────────────────────────────────────────────────

console.log("\x1b[36m第 23 章 Demo：多 Agent 协作\x1b[0m");
console.log("\x1b[90mCoordinator + Worker 模式的 Code Review 场景\x1b[0m\n");

// ═══ 阶段 1：Coordinator 分解任务 ═══
console.log("\x1b[33m═══ 阶段 1：Coordinator 分解任务 ═══\x1b[0m");
console.log("\x1b[90m收到 PR Review 请求，分解为三个子任务\x1b[0m\n");

const decomposition: TaskDecomposition = {
  subtasks: [
    { worker: "security-reviewer", task: "Review for security vulnerabilities: SQL injection, XSS, auth bypass, secrets exposure" },
    { worker: "perf-reviewer", task: "Review for performance issues: N+1 queries, missing indexes, memory leaks, blocking I/O" },
    { worker: "style-reviewer", task: "Review for code style: naming conventions, dead code, complexity, documentation" },
  ],
};

const coordinator = createSubAgent("coordinator", "You are a senior tech lead coordinating code reviews.", [
  // Response 1: decomposition (simulated as JSON)
  { content: [{ type: "text", text: JSON.stringify(decomposition) }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
  // Response 2: synthesis
  { content: [{ type: "text", text: "## PR Review Summary\n\n### Critical (2)\n- SQL injection in user query (security)\n- Unbounded query without LIMIT (perf)\n\n### Warnings (4)\n- Missing input validation on email field (security)\n- Function `processData` exceeds 50 lines (style)\n- Unused import `lodash` (style)\n- No JSDoc on public API (style)\n\n### Verdict: REQUEST CHANGES\nFix critical security and performance issues before merge." }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
]);

const result = await coordinatorDecompose(coordinator, "Review PR #42: adds user search endpoint");
console.log("  任务分解结果：");
result.subtasks.forEach(st => {
  console.log(`    → [${st.worker}] ${st.task.slice(0, 60)}...`);
});
console.log();

// ═══ 阶段 2：Workers 并行执行 ═══
console.log("\x1b[33m═══ 阶段 2：Workers 并行执行 ═══\x1b[0m");
console.log("\x1b[90m三个 Worker 各自独立上下文，并行执行\x1b[0m\n");

const workers = [
  createSubAgent("security-reviewer",
    "You are a security expert. Find vulnerabilities in code changes.",
    [{ content: [{ type: "text", text: "Found 2 issues:\n1. [CRITICAL] SQL injection: raw user input in query string at line 42\n2. [WARNING] Missing input validation on email field" }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any],
  ),
  createSubAgent("perf-reviewer",
    "You are a performance engineer. Find performance issues.",
    [{ content: [{ type: "text", text: "Found 1 issue:\n1. [CRITICAL] Unbounded query without LIMIT — could fetch millions of rows on large datasets" }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any],
  ),
  createSubAgent("style-reviewer",
    "You are a code style reviewer. Check naming, complexity, documentation.",
    [{ content: [{ type: "text", text: "Found 3 issues:\n1. [WARNING] Function `processData` exceeds 50 lines — consider splitting\n2. [INFO] Unused import `lodash` at line 3\n3. [INFO] No JSDoc on public API method `searchUsers`" }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any],
  ),
];

const workerResults = await dispatchWorkers(workers, decomposition.subtasks);

for (const wr of workerResults) {
  const issueCount = (wr.result.match(/\d+\./g) ?? []).length;
  console.log(`  \x1b[32m[${wr.worker}]\x1b[0m 发现 ${issueCount} 个问题`);
  wr.result.split("\n").forEach(line => {
    if (line.trim()) console.log(`    ${line.trim()}`);
  });
  console.log();
}

// Show isolation proof
console.log("  \x1b[90m── 隔离验证 ──\x1b[0m");
workers.forEach(w => {
  console.log(`    [${w.name}] 消息数: ${w.messages.length}（独立历史）`);
});
console.log();

// ═══ 阶段 3：Coordinator 汇总结果 ═══
console.log("\x1b[33m═══ 阶段 3：Coordinator 汇总结果 ═══\x1b[0m");
console.log("\x1b[90mCoordinator 综合所有 Worker 结果，给出最终结论\x1b[0m\n");

const synthesis = await coordinatorSynthesize(coordinator, workerResults);
console.log("  \x1b[32m汇总报告：\x1b[0m");
synthesis.split("\n").forEach(line => console.log(`  ${line}`));
console.log();

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\x1b[33m═══ 多 Agent 协作总结 ═══\x1b[0m\n");
console.log("  概念                  说明");
console.log("  ─────────────────────────────────────────────────────────────────");
console.log("  SubAgent              独立 system prompt + 消息历史，上下文隔离");
console.log("  Coordinator           负责任务分解、分发和结果汇总");
console.log("  Worker                执行具体子任务，互不干扰");
console.log("  并行执行              Workers 独立运行，无共享状态");
console.log("  结果汇总              Coordinator 综合多个视角给出最终判断");
console.log();
console.log("\x1b[90m关键认知：单个 Agent 的能力有限，多 Agent 协作让系统能力超越单模型极限。\x1b[0m\n");
