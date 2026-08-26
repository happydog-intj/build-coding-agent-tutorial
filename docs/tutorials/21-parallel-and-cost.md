---
title: "并行执行与成本控制"
description: "并行工具执行引擎、AbortController 取消传播、Token 用量追踪与预算控制"
---

# 第 21 章：并行执行与成本控制

> 模型一次可以返回多个工具调用。串行执行浪费时间，并行执行需要处理竞态和取消。同时，每次 API 调用都在花钱——你需要知道花了多少、还能花多少。

## 这一章要解决什么问题？

两个独立但都重要的生产问题：

1. **并行执行**：LLM 返回 3 个 tool_use，串行执行要等 3 倍时间。并行执行快，但要处理：某个工具超时怎么办？用户按 Ctrl+C 怎么取消全部？
2. **成本控制**：Agent 跑一次可能消耗 $0.5-5。用户需要实时看到花了多少，系统需要在预算耗尽前停止。

---

## 并行工具执行

### 从串行到并行

第 7 章的 Agent Loop 是串行执行工具的：

```typescript
// 串行：总时间 = 工具1耗时 + 工具2耗时 + 工具3耗时
for (const toolCall of response.toolCalls) {
  const result = await executeTool(toolCall);
  results.push(result);
}
```

改为并行：

```typescript
// 并行：总时间 = max(工具1耗时, 工具2耗时, 工具3耗时)
const results = await Promise.all(
  response.toolCalls.map(tc => executeTool(tc))
);
```

但 `Promise.all` 太粗暴——一个失败全部失败，没有超时控制，没有取消机制。

### 带取消的并行执行器

```typescript
interface ExecutionOptions {
  timeout?: number;          // 单个工具超时（ms）
  signal?: AbortSignal;      // 外部取消信号（Ctrl+C）
  concurrency?: number;      // 最大并发数
}

async function executeToolsParallel(
  toolCalls: ToolCall[],
  tools: Tool[],
  options: ExecutionOptions = {}
): Promise<ToolResult[]> {
  const { timeout = 30_000, signal, concurrency = 5 } = options;

  // 为每个工具创建独立的 AbortController
  const controllers = toolCalls.map(() => new AbortController());

  // 外部信号取消时，取消所有子任务
  signal?.addEventListener("abort", () => {
    controllers.forEach(c => c.abort());
  });

  // 并发控制：用信号量限制同时执行的数量
  const semaphore = new Semaphore(concurrency);

  const promises = toolCalls.map(async (tc, i) => {
    await semaphore.acquire();
    try {
      return await executeWithTimeout(tc, tools, {
        timeout,
        signal: controllers[i].signal,
      });
    } finally {
      semaphore.release();
    }
  });

  // allSettled：即使部分失败也返回所有结果
  const settled = await Promise.allSettled(promises);

  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    return {
      content: `Tool ${toolCalls[i].name} failed: ${s.reason?.message ?? "unknown error"}`,
      isError: true,
    };
  });
}
```

### 单个工具的超时包装

```typescript
async function executeWithTimeout(
  toolCall: ToolCall,
  tools: Tool[],
  options: { timeout: number; signal: AbortSignal }
): Promise<ToolResult> {
  const tool = tools.find(t => t.name === toolCall.name);
  if (!tool) {
    return { content: `Unknown tool: ${toolCall.name}`, isError: true };
  }

  // 合并超时和外部取消信号
  const timeoutSignal = AbortSignal.timeout(options.timeout);
  const combinedSignal = AbortSignal.any([options.signal, timeoutSignal]);

  try {
    const result = await tool.execute(toolCall.arguments, {
      signal: combinedSignal,
    });
    return result;
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { content: `Tool ${toolCall.name} was cancelled`, isError: true };
    }
    if (err.name === "TimeoutError") {
      return { content: `Tool ${toolCall.name} timed out after ${options.timeout}ms`, isError: true };
    }
    return { content: `Tool ${toolCall.name} error: ${err.message}`, isError: true };
  }
}
```

### 简易信号量

```typescript
class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}
```

---

## 集成到 Agent Loop

```typescript
// 更新 Agent Loop 的工具执行部分
const abortController = new AbortController();

// Ctrl+C 触发取消
process.on("SIGINT", () => {
  abortController.abort();
});

// 在循环中使用并行执行
if (response.stopReason === "tool_use") {
  const results = await executeToolsParallel(
    response.toolCalls,
    config.tools,
    { signal: abortController.signal, timeout: 60_000, concurrency: 3 }
  );

  // 将结果配对回 messages
  for (let i = 0; i < response.toolCalls.length; i++) {
    messages.push({
      role: "tool_result",
      toolUseId: response.toolCalls[i].id,
      content: results[i].content,
      isError: results[i].isError,
    });
  }
}
```

---

## Cost Tracking

### Token 用量统计

每次 LLM 调用都返回 token 使用情况。累计追踪：

```typescript
interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;         // 美元
}

class CostTracker {
  private stats: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
  };

  private pricing: Record<string, { input: number; output: number }> = {
    "claude-sonnet-4": { input: 3.0, output: 15.0 },   // $/M tokens
    "claude-haiku-4":  { input: 0.25, output: 1.25 },
    "gpt-4o":          { input: 2.5, output: 10.0 },
  };

  record(model: string, usage: { input: number; output: number; cacheRead?: number }) {
    this.stats.inputTokens += usage.input;
    this.stats.outputTokens += usage.output;
    this.stats.cacheReadTokens += usage.cacheRead ?? 0;

    const price = this.pricing[model];
    if (price) {
      this.stats.totalCost +=
        (usage.input * price.input + usage.output * price.output) / 1_000_000;
    }
  }

  get current(): UsageStats {
    return { ...this.stats };
  }

  format(): string {
    const { inputTokens, outputTokens, totalCost } = this.stats;
    return `Tokens: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out | Cost: $${totalCost.toFixed(4)}`;
  }
}
```

### Token Budget

设置上限，防止 Agent 无限运行烧钱：

```typescript
interface BudgetConfig {
  maxTotalTokens?: number;    // 总 token 上限
  maxOutputTokens?: number;   // 单次输出上限
  maxCostUsd?: number;        // 总费用上限
  maxTurns?: number;          // 最大轮数
}

class BudgetGuard {
  constructor(
    private budget: BudgetConfig,
    private tracker: CostTracker
  ) {}

  check(): { allowed: boolean; reason?: string } {
    const stats = this.tracker.current;

    if (this.budget.maxTotalTokens) {
      const total = stats.inputTokens + stats.outputTokens;
      if (total >= this.budget.maxTotalTokens) {
        return { allowed: false, reason: `Token 预算耗尽 (${total.toLocaleString()} tokens)` };
      }
    }

    if (this.budget.maxCostUsd && stats.totalCost >= this.budget.maxCostUsd) {
      return { allowed: false, reason: `费用预算耗尽 ($${stats.totalCost.toFixed(2)})` };
    }

    return { allowed: true };
  }

  remaining(): { tokens?: number; cost?: number } {
    const stats = this.tracker.current;
    return {
      tokens: this.budget.maxTotalTokens
        ? this.budget.maxTotalTokens - stats.inputTokens - stats.outputTokens
        : undefined,
      cost: this.budget.maxCostUsd
        ? this.budget.maxCostUsd - stats.totalCost
        : undefined,
    };
  }
}
```

### 集成到 Agent Loop

```typescript
while (true) {
  // 每轮开始前检查预算
  const budgetCheck = budgetGuard.check();
  if (!budgetCheck.allowed) {
    yield { type: "error", message: `⚠️ ${budgetCheck.reason}，Agent 停止。` };
    break;
  }

  const response = await streamFn(config.model, messages);

  // 记录本次调用的 token 用量
  costTracker.record(config.model, response.usage);

  // 显示实时费用
  yield { type: "status", message: costTracker.format() };

  if (response.stopReason !== "tool_use") break;
  // ... 工具执行 ...
}
```

---

## 实时显示

在 CLI 中实时展示费用信息：

```
You: 帮我重构这个模块

Agent: 我来分析一下当前的代码结构...
       [读取 5 个文件]
       [执行 npm test]

       重构计划如下：
       1. 提取公共逻辑到 utils.ts
       2. ...

─────────────────────────────────────
 Tokens: 12,340 in / 3,210 out | Cost: $0.0854 | Budget: $1.00 remaining
```

---

## 小结

并行执行让多工具调用从串行等待变为同时进行，核心是 `Promise.allSettled` + AbortController 取消传播 + 信号量控制并发数。每个工具有独立的超时和取消信号，单个失败不影响其他工具。成本控制通过 CostTracker 累计每次 API 调用的 token 用量和费用，BudgetGuard 在每轮开始前检查是否超出预算。两者结合让 Agent 既快又可控——并行执行提升效率，预算守卫防止失控。
