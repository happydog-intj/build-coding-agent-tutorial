---
title: "Harness 工程 — 重试、验证与防死循环"
description: "应对 LLM 幻觉和不可靠性：最大迭代数、连续错误检测、输出验证、Proposer-Reviewer 模式"
---

# 第 17 章：Harness 工程 — 模型不可靠时的工程补救

> 模型会幻觉、会死循环、会过早结束任务。Harness 是 Agent Loop 外层的控制层——确保模型行为符合预期。

## 这一章要解决什么问题？

前面的 Agent Loop 假设模型总是正确的：它说调工具就调，它说结束就结束。但现实中：

- 模型可能无限循环调用同一个工具（死循环）
- 模型可能一轮就说"完成了"但实际上什么都没做（过早终止）
- 模型调工具时参数可能是错的（幻觉参数）
- 模型连续失败后可能陷入重复同样错误的循环

Harness 工程解决的是：在不修改 LLM 的前提下，通过工程手段让 Agent 行为更可靠。

---

## Harness 的定义

**Harness = Agent Loop 外层的控制、验证和修正层。**

```
用户 → [Harness] → Agent Loop → LLM → 工具
                ↑                          |
                └──── 验证/重试/修正 ──────┘
```

Harness 不是 prompt（那是第 16 章），而是代码层面的保障。核心手段：

| 手段 | 作用 |
|------|------|
| Max Iterations | 防止死循环 |
| 输出验证 | 检查结果是否满足预期 |
| 自动重试 | 可恢复的错误自动重试 |
| 退避策略 | 连续失败时逐步退避 |
| Proposer-Reviewer | 两次 LLM 调用交叉验证 |

---

## 第一道防线：Max Iterations

最简单也最重要的 harness——限制 Agent Loop 的最大迭代次数：

```typescript
const MAX_ITERATIONS = 25;

async function runAgent(prompt: string, messages: Message[], config: AgentConfig) {
  messages.push({ role: "user", content: prompt, timestamp: Date.now() });
  let iterations = 0;

  while (true) {
    iterations++;
    if (iterations > MAX_ITERATIONS) {
      console.log("⚠️ Max iterations reached. Forcing stop.");
      break;
    }
    // ... 正常的 Agent Loop
  }
}
```

为什么这很重要？没有这个保护，一个幻觉参数的工具调用可能让 Agent 进入无限"调用→失败→重调"循环，消耗大量 token 和费用。

---

## 第二道防线：连续失败检测

比 max iterations 更精细——检测连续工具调用失败的模式：

```typescript
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

for (const tc of toolCalls) {
  const result = await executeTool(tc);

  if (result.isError) {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      // 注入提示让模型换策略
      messages.push({
        role: "user",
        content: `⚠️ You have failed ${consecutiveErrors} times in a row. Stop and try a different approach, or explain what's blocking you.`,
        timestamp: Date.now(),
      });
      consecutiveErrors = 0;
      break;  // 重新进入 LLM 让它反思
    }
  } else {
    consecutiveErrors = 0;  // 成功则重置
  }
}
```

这比粗暴停止更好——给模型一个机会换策略。

---

## 第三道防线：输出验证

某些任务有明确的成功标准。验证层在 Agent 说"完成"后检查是否真的完成了：

```typescript
interface TaskVerifier {
  check: () => { passed: boolean; reason?: string };
}

async function runWithVerification(
  prompt: string,
  messages: Message[],
  config: AgentConfig,
  verifier?: TaskVerifier,
  maxRetries: number = 2,
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await runAgent(prompt, messages, config);

    if (!verifier) return;  // 无验证器，直接返回

    const { passed, reason } = verifier.check();
    if (passed) return;

    // 验证失败，注入反馈让模型重试
    messages.push({
      role: "user",
      content: `Verification failed: ${reason}\nPlease fix this issue.`,
      timestamp: Date.now(),
    });
  }
}
```

例：让 Agent 修 bug，验证器运行测试看是否通过：

```typescript
const testVerifier: TaskVerifier = {
  check: () => {
    try {
      execSync('npm test', { encoding: 'utf-8' });
      return { passed: true };
    } catch (e: any) {
      return { passed: false, reason: e.stdout?.slice(-500) ?? 'Tests failed' };
    }
  },
};
```

---

## 第四道防线：Proposer-Reviewer 模式

对高风险操作，用两次 LLM 调用交叉验证——第一次生成方案，第二次审核方案：

```typescript
async function proposerReviewer(
  task: string,
  messages: Message[],
  config: AgentConfig,
): Promise<boolean> {
  // Proposer: 生成操作计划
  const planPrompt = `Plan how to accomplish: ${task}\nList the steps you will take. Do NOT execute yet.`;
  await runAgent(planPrompt, messages, config);

  // Reviewer: 审核计划
  const reviewPrompt = `Review the plan above. Is it safe and correct?
  Check for:
  - Destructive operations without backup
  - Assumptions about file contents without reading first
  - Missing error handling
  Reply with APPROVE or REJECT with reasons.`;
  await runAgent(reviewPrompt, messages, config);

  // 提取审核结果
  const lastReply = messages.filter(m => m.role === 'assistant').pop();
  const approved = lastReply?.content?.some(
    (c: any) => c.type === 'text' && c.text.includes('APPROVE')
  );

  return approved ?? false;
}
```

这个模式的价值：一个 LLM 生成方案时容易过于自信；另一个 LLM（或同一个换角色）审核时更容易发现漏洞。

---

## 组合使用

真实产品中这些手段组合使用：

```typescript
const harnessConfig = {
  maxIterations: 25,             // 绝对上限
  maxConsecutiveErrors: 3,       // 连续失败检测
  retryOnVerificationFail: 2,   // 验证失败重试次数
  requireReviewForDestructive: true,  // 危险操作需审核
};
```

层层防御，每层解决不同的故障模式。

---

## 小结

Harness 不是让模型变聪明——是让系统变可靠：

| 故障模式 | Harness 手段 |
|----------|-------------|
| 无限循环 | Max Iterations |
| 重复犯同样错误 | 连续失败检测 + 策略切换提示 |
| 过早终止（说完了但没做） | 输出验证 + 自动重试 |
| 高风险操作不审慎 | Proposer-Reviewer 交叉验证 |
| 偶发 API 错误 | 指数退避重试 |

关键认知：**模型不可靠是常态，不是异常。** 好的 Agent 不是用更好的模型，而是在模型之外建立了足够的工程保障。这就是为什么 bojieli 说"Harness 是模型之外的竞争力"。
