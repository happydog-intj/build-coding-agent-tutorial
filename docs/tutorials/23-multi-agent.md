---
title: "多 Agent 协作 — 从单兵到团队"
description: "任务分解与调度：Coordinator 模式、Worker Agent、消息传递、并行子代理"
---

# 第 23 章：多 Agent 协作 — 从单兵到团队

> 一个 Agent 处理复杂任务时容易迷失方向、上下文溢出、顾此失彼。多 Agent 把大问题拆给专门的角色——每个 Agent 专注一件事，协调者把结果汇总。

## 这一章要解决什么问题？

单 Agent 的局限性：

- **上下文争抢**：审查代码安全性和审查代码风格需要完全不同的"思维模式"，放在一个上下文里会互相干扰
- **串行瓶颈**：分析 10 个文件的 bug，串行要 10 倍时间
- **专业化缺失**：一个 Agent 既要写代码又要写测试又要做 review，不如让专门的 Agent 各司其职

多 Agent 的核心思想：**分解 → 并行 → 汇总**。

---

## 架构模式

### Coordinator + Worker 模式

```
                    ┌─────────────┐
                    │ Coordinator │
                    │ (编排者)     │
                    └──────┬──────┘
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │ Worker A │ │ Worker B │ │ Worker C │
      │ (安全审查) │ │ (性能审查) │ │ (风格审查) │
      └──────────┘ └──────────┘ └──────────┘
```

- **Coordinator**：接收用户任务，分解为子任务，分发给 Worker，汇总结果
- **Worker**：接收单一明确的子任务，独立执行，返回结果

---

## SubAgent 基础实现

首先定义子代理的执行接口：

```typescript
interface SubAgentConfig {
  name: string;
  systemPrompt: string;
  tools: Tool[];
  model?: string;
  timeout?: number;
}

interface SubAgentResult {
  agentName: string;
  output: string;
  success: boolean;
  tokensUsed: number;
}

async function runSubAgent(
  task: string,
  config: SubAgentConfig
): Promise<SubAgentResult> {
  const messages: Message[] = [];
  const startTokens = 0;

  try {
    // 子代理有自己独立的消息历史和 system prompt
    const result = await runAgentLoop(task, messages, {
      systemPrompt: config.systemPrompt,
      tools: config.tools,
      model: config.model ?? "fast-model",
      maxTurns: 20,
    });

    return {
      agentName: config.name,
      output: result.finalResponse,
      success: true,
      tokensUsed: result.totalTokens,
    };
  } catch (err: any) {
    return {
      agentName: config.name,
      output: `Error: ${err.message}`,
      success: false,
      tokensUsed: 0,
    };
  }
}
```

关键设计：每个子代理有**独立的消息历史和 system prompt**，不会互相污染上下文。

---

## Coordinator 实现

```typescript
interface CoordinatorConfig {
  workers: SubAgentConfig[];
  model: string;
  tools: Tool[];
}

async function runCoordinator(
  userTask: string,
  config: CoordinatorConfig
): Promise<string> {
  // 第 1 步：让 Coordinator 分解任务
  const planPrompt = `You are a task coordinator. Break down this task into subtasks
for specialized workers.

Available workers:
${config.workers.map(w => `- ${w.name}: ${w.systemPrompt.slice(0, 100)}`).join("\n")}

User task: ${userTask}

Return a JSON array of assignments:
[{"worker": "name", "task": "specific subtask description"}]`;

  const planResponse = await callLLM(config.model, planPrompt);
  const assignments: { worker: string; task: string }[] = JSON.parse(planResponse);

  // 第 2 步：并行派发给 Workers
  const workerPromises = assignments.map(async (assignment) => {
    const workerConfig = config.workers.find(w => w.name === assignment.worker);
    if (!workerConfig) {
      return { agentName: assignment.worker, output: "Worker not found", success: false, tokensUsed: 0 };
    }
    return runSubAgent(assignment.task, workerConfig);
  });

  const results = await Promise.allSettled(workerPromises);
  const workerOutputs = results.map(r =>
    r.status === "fulfilled" ? r.value : { agentName: "unknown", output: "Failed", success: false, tokensUsed: 0 }
  );

  // 第 3 步：汇总结果
  const synthesisPrompt = `You are synthesizing results from multiple specialized workers.

Original task: ${userTask}

Worker results:
${workerOutputs.map(r => `### ${r.agentName} (${r.success ? "✓" : "✗"})\n${r.output}`).join("\n\n")}

Synthesize these into a coherent final response for the user.
Resolve any conflicts between worker outputs.
Highlight the most critical findings.`;

  return callLLM(config.model, synthesisPrompt);
}
```

---

## 实例：多 Agent 代码审查

```typescript
// 定义三个专门的 Worker
const securityReviewer: SubAgentConfig = {
  name: "security-reviewer",
  systemPrompt: `You are a security expert. Review code for:
- SQL injection, XSS, command injection
- Authentication/authorization flaws
- Secrets in code
- Unsafe deserialization
Report ONLY security issues. Ignore style or performance.`,
  tools: [readFileTool, searchFilesTool, bashTool],
};

const performanceReviewer: SubAgentConfig = {
  name: "performance-reviewer",
  systemPrompt: `You are a performance expert. Review code for:
- O(n²) or worse algorithms
- Unnecessary allocations in hot paths
- Missing indexes in database queries
- Unbounded data structures
Report ONLY performance issues. Ignore style or security.`,
  tools: [readFileTool, searchFilesTool, bashTool],
};

const styleReviewer: SubAgentConfig = {
  name: "style-reviewer",
  systemPrompt: `You are a code style expert. Review code for:
- Naming inconsistencies
- Dead code
- Missing error handling
- Overly complex functions (>50 lines)
Report ONLY style/maintainability issues. Ignore security or performance.`,
  tools: [readFileTool, searchFilesTool],
};

// 使用
const review = await runCoordinator(
  "Review the changes in the last commit for any issues",
  {
    workers: [securityReviewer, performanceReviewer, styleReviewer],
    model: "claude-sonnet-4",
    tools: [],
  }
);
```

每个 Worker 只关注一个维度，不会互相干扰。Coordinator 汇总时解决冲突、排优先级。

---

## Agent 间通信

更复杂的场景中，Agent 之间需要通信（不只是 Coordinator → Worker 的单向派发）：

```typescript
interface AgentMessage {
  from: string;
  to: string;
  content: string;
  timestamp: number;
}

class MessageBus {
  private queues: Map<string, AgentMessage[]> = new Map();

  send(msg: AgentMessage): void {
    const queue = this.queues.get(msg.to) ?? [];
    queue.push(msg);
    this.queues.set(msg.to, queue);
  }

  receive(agentName: string): AgentMessage[] {
    const messages = this.queues.get(agentName) ?? [];
    this.queues.set(agentName, []); // 读后清空
    return messages;
  }
}
```

使用场景：Worker A 发现了一个安全问题，通知 Worker B 检查相关的性能影响。

```typescript
// Security worker 发现问题后通知 performance worker
messageBus.send({
  from: "security-reviewer",
  to: "performance-reviewer",
  content: "Found SQL query in auth.ts:42 that needs parameterization. Check if this path is in a hot loop.",
  timestamp: Date.now(),
});
```

---

## 并发控制与资源管理

多 Agent 并行时需要注意资源竞争：

```typescript
interface MultiAgentOptions {
  maxConcurrency: number;     // 最多同时跑几个 Agent
  totalBudget: number;        // 所有 Agent 共享的 token 预算
  timeout: number;            // 单个 Agent 超时
}

async function runWorkersParallel(
  assignments: { worker: SubAgentConfig; task: string }[],
  options: MultiAgentOptions
): Promise<SubAgentResult[]> {
  const semaphore = new Semaphore(options.maxConcurrency);
  let totalTokensUsed = 0;

  const results = await Promise.allSettled(
    assignments.map(async ({ worker, task }) => {
      await semaphore.acquire();
      try {
        // 检查共享预算
        if (totalTokensUsed >= options.totalBudget) {
          return { agentName: worker.name, output: "Budget exhausted", success: false, tokensUsed: 0 };
        }

        const result = await runSubAgent(task, {
          ...worker,
          timeout: options.timeout,
        });

        totalTokensUsed += result.tokensUsed;
        return result;
      } finally {
        semaphore.release();
      }
    })
  );

  return results.map(r =>
    r.status === "fulfilled" ? r.value : { agentName: "unknown", output: "Failed", success: false, tokensUsed: 0 }
  );
}
```

---

## 适用场景

| 场景 | 模式 | Agent 配置 |
|------|------|-----------|
| 代码审查 | 并行 Workers | Security + Performance + Style |
| 大型重构 | Pipeline | Planner → Implementer → Tester |
| 复杂调试 | 协作 | Reproducer → Analyzer → Fixer |
| 文档生成 | 并行 + 汇总 | 每个模块一个 Writer → Editor 汇总 |

### 什么时候不需要多 Agent

- 任务简单，单 Agent 几轮就能完成
- 上下文不会溢出
- 不需要多维度并行
- 通信开销大于收益（子任务间强依赖）

**经验法则**：先用单 Agent 试。当你发现 Agent 在多个维度间来回切换、丢失信息、或者串行太慢时，再拆成多 Agent。

---

## 小结

多 Agent 的核心是**分解 → 并行 → 汇总**。Coordinator 负责理解任务、分解为子任务、分发给专门的 Worker、最后汇总结果。每个 Worker 有独立的上下文和 system prompt，专注一个维度，不互相干扰。并行执行通过信号量控制并发、共享 token 预算防止超支。Agent 间通信通过消息总线实现，支持更复杂的协作模式。关键原则：单 Agent 能搞定的不要用多 Agent——多 Agent 的价值在于专业化分工和并行加速，代价是协调开销和结果合并的复杂性。
