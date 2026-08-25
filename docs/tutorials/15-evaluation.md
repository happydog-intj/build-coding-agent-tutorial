# 第 15 章：评测 — 证明你的 Agent 能工作

> "我试了一次能跑"不是可靠性的证明。怎么系统化地验证 Agent 能解决编程任务？

## 这一章要解决什么问题？

你写了一个 Coding Agent，手动试了几次发现"能用"。但这不够——可能换个任务就出错了、换个模型就失败了、改了一行代码就退化了。

评测（Evaluation）解决的是：给 Agent 一组任务，自动运行，自动判定是否通过。像单元测试验证代码行为一样，评测验证 Agent 行为。

---

## 评测的结构

一个评测用例（EvalCase）由三部分组成：

```typescript
interface EvalCase {
  name: string;           // 用例名称
  prompt: string;         // 发给 Agent 的指令
  prepare: () => void;    // 准备环境（创建文件等）
  verify: () => boolean;  // 验证结果（检查文件是否正确）
}
```

三步流程：

```
prepare() → Agent 执行 prompt → verify()
```

`prepare` 搭建初始环境（比如创建一个有 bug 的文件），`prompt` 是发给 Agent 的任务，`verify` 检查 Agent 是否完成了任务（比如检查 bug 是否被修复）。

---

## 一个具体的评测用例

"让 Agent 创建一个 hello world 文件"：

```typescript
const createFileCase: EvalCase = {
  name: "create-hello-file",
  prompt: "Create a file called hello.txt with the content 'Hello, World!'",

  prepare: () => {
    // 确保文件不存在
    if (fs.existsSync("hello.txt")) fs.unlinkSync("hello.txt");
  },

  verify: () => {
    // 文件存在且内容正确
    if (!fs.existsSync("hello.txt")) return false;
    const content = fs.readFileSync("hello.txt", "utf-8");
    return content.trim() === "Hello, World!";
  },
};
```

更复杂的用例——修复一个 bug：

```typescript
const fixBugCase: EvalCase = {
  name: "fix-off-by-one",
  prompt: "There's an off-by-one error in counter.ts. Fix it so the test passes.",

  prepare: () => {
    // 创建有 bug 的源文件
    fs.writeFileSync("counter.ts", `
export function count(n: number): number[] {
  const result = [];
  for (let i = 0; i < n; i++) {  // bug: should be <= n
    result.push(i);
  }
  return result;
}
`);
    // 创建测试文件
    fs.writeFileSync("counter.test.ts", `
import { count } from "./counter";
import { test, expect } from "vitest";

test("count(3) returns [0, 1, 2, 3]", () => {
  expect(count(3)).toEqual([0, 1, 2, 3]);
});
`);
  },

  verify: () => {
    // 运行测试，检查是否通过
    const result = execSync("npx vitest run --reporter=json 2>/dev/null", {
      encoding: "utf-8",
    });
    const report = JSON.parse(result);
    return report.numPassedTests === 1 && report.numFailedTests === 0;
  },
};
```

---

## 评测 Runner

Runner 负责隔离执行每个用例：

```typescript
interface EvalResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

async function runEval(cases: EvalCase[], config: AgentConfig): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const evalCase of cases) {
    // 每个用例在独立的临时目录中执行
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-"));
    const originalDir = process.cwd();
    process.chdir(tmpDir);

    const start = Date.now();
    let passed = false;
    let error: string | undefined;

    try {
      // 1. 准备环境
      evalCase.prepare();

      // 2. 运行 Agent
      const messages: Message[] = [];
      await runAgent(evalCase.prompt, messages, config);

      // 3. 验证结果
      passed = evalCase.verify();
    } catch (err: any) {
      error = err.message;
      passed = false;
    } finally {
      process.chdir(originalDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    results.push({
      name: evalCase.name,
      passed,
      error,
      durationMs: Date.now() - start,
    });
  }

  return results;
}
```

关键设计：每个用例在独立的临时目录中运行，互不影响。结束后清理。

---

## 报告输出

运行完所有用例后生成简洁的报告：

```typescript
function printReport(results: EvalResult[]): void {
  console.log("\n═══ Eval Report ═══\n");

  for (const r of results) {
    const icon = r.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const time = `\x1b[90m(${r.durationMs}ms)\x1b[0m`;
    console.log(`  ${icon} ${r.name} ${time}`);
    if (r.error) {
      console.log(`    \x1b[31m${r.error}\x1b[0m`);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const color = passed === total ? "\x1b[32m" : "\x1b[31m";
  console.log(`\n${color}${passed}/${total} passed\x1b[0m\n`);
}
```

输出效果：

```
═══ Eval Report ═══

  ✓ create-hello-file (1200ms)
  ✓ fix-off-by-one (3400ms)
  ✗ refactor-extract-function (8200ms)
    Expected function 'parseConfig' to exist in utils.ts

2/3 passed
```

---

## 用 ScriptedModel 做确定性评测

第 05 章的 ScriptedModel 在评测中的另一个用途：验证 Agent Loop 本身的行为，不依赖真实模型。这有点像单元测试中的mock，只验证behavior，不验证结果。

```typescript
const scriptedConfig: AgentConfig = {
  model: scriptedModel,
  streamFn: (model, context) => model.stream(context),
  tools: allTools,
  systemPrompt: "...",
};

// 测试：Agent 收到 toolUse 响应后会执行工具
const toolUseCase: EvalCase = {
  name: "agent-executes-tool",
  prompt: "read the file",

  prepare: () => {
    fs.writeFileSync("test.txt", "file content here");
    // ScriptedModel 预设响应：调用 read_file
    scriptedModel.setResponses([
      { toolCalls: [{ name: "read_file", arguments: { path: "test.txt" } }] },
      { text: "The file contains: file content here" },
    ]);
  },

  verify: () => {
    // 验证 Agent 确实执行了工具（通过检查 messages 中有 toolResult）
    return messages.some(m => m.role === "toolResult");
  },
};
```

ScriptedModel 让你测试 Agent Loop 的逻辑（正确执行工具、正确配对 toolResult、正确终止循环），不需要花真实的 API 调用费用。

---

## 评测设计的要点

| 要点 | 说明 |
|------|------|
| 隔离 | 每个用例在独立临时目录，不互相污染 |
| 可重复 | 相同的 prepare + prompt 应该产生相同结果 |
| 自动判定 | verify 返回 boolean，不需要人工检查 |
| 快速反馈 | 简单用例几秒钟完成，复杂用例设超时 |
| 分层 | 用 ScriptedModel 测逻辑，用真实模型测能力 |

---

## 评测的两个层级

**第一层：Agent Loop 逻辑测试**

用 ScriptedModel，验证 Loop 本身的行为：
- 没有 toolCall 时是否正确终止？
- toolCall 和 toolResult 是否正确配对？
- 工具执行出错时 isError 是否正确设置？

这些测试快速（毫秒级）、确定性（不依赖模型），属于单元测试范畴。

**第二层：Agent 能力测试**

用真实模型，验证 Agent 能否完成实际任务：
- 能否根据描述创建正确的文件？
- 能否读取文件并回答问题？
- 能否定位并修复 bug？
- 能否运行测试并根据失败信息修复代码？

这些测试慢（秒到分钟级）、非确定性（模型可能有不同的解法），属于集成测试范畴。

---

## 非确定性的处理

真实模型每次输出可能不同。应对策略：

```typescript
// 策略 1：验证结果而不是过程
// 不检查 Agent 用了什么方法，只检查最终结果
verify: () => {
  const content = fs.readFileSync("output.ts", "utf-8");
  return content.includes("export function parseConfig");
},

// 策略 2：多次运行取通过率
async function runWithRetries(evalCase: EvalCase, config: AgentConfig, n: number) {
  let passes = 0;
  for (let i = 0; i < n; i++) {
    const [result] = await runEval([evalCase], config);
    if (result.passed) passes++;
  }
  return { passRate: passes / n };  // 3/5 = 60% 通过率
}
```

策略 1 更实用——只关心最终输出是否正确，不关心 Agent 选了哪条路。

---

## 进阶指标：Pass@k 与 Pass^k

简单的 pass/fail 只是起点。业界评估 Agent 能力时用两个补充指标：

**Pass@k**——跑 k 次，只要有一次通过就算通过。衡量的是 Agent 的**能力上限**（"它能不能做到？"）。

```typescript
async function passAtK(evalCase: EvalCase, config: AgentConfig, k: number): Promise<boolean> {
  for (let i = 0; i < k; i++) {
    const [result] = await runEval([evalCase], config);
    if (result.passed) return true;
  }
  return false;
}
// Pass@5 = 跑 5 次只要有 1 次通过
```

**Pass^k**——跑 k 次，必须全部通过才算通过。衡量的是**业务可靠性**（"它可靠吗？"）。

```typescript
async function passExpK(evalCase: EvalCase, config: AgentConfig, k: number): Promise<boolean> {
  for (let i = 0; i < k; i++) {
    const [result] = await runEval([evalCase], config);
    if (!result.passed) return false;
  }
  return true;
}
// Pass^5 = 跑 5 次必须全部通过
```

两者的区别至关重要：

| 指标 | 含义 | 适用场景 |
|------|------|----------|
| Pass@k | 能力存在性 | 技术评估、选模型 |
| Pass^k | 部署可靠性 | 生产决策、SLA 承诺 |

Agent 可能 Pass@5 = 100% 但 Pass^5 = 30%——它有能力做到，但不够稳定。

---

## LLM-as-a-Judge：当 verify() 写不出来时

有些任务没有确定性的验证函数——比如"写一段好的文档"。这时可以用另一个 LLM 来判断：

```typescript
async function llmJudge(
  task: string,
  agentOutput: string,
  judgeModel: any,
): Promise<{ score: number; reason: string }> {
  const judgePrompt = `You are evaluating an AI agent's output.

Task: ${task}

Agent's output:
${agentOutput}

Rate 1-5 and explain:
1 = completely wrong
3 = partially correct
5 = fully correct and well done

Reply as JSON: {"score": N, "reason": "..."}`;

  // 调用 judge 模型
  const response = await judgeModel.complete(judgePrompt);
  return JSON.parse(response);
}
```

LLM-as-a-Judge 的注意事项：
- **用比被评估模型更强的模型做 judge**（或至少同级）
- **给明确的评分标准**——不要让 judge 自己发明标准
- **多次打分取平均**——单次 judge 也有随机性
- **区分"做对了"和"做得好"**——功能正确 vs 代码质量是不同维度

---

## 小结

评测是系统化验证 Agent 能力的方式。每个 EvalCase 由 prepare（搭建环境）、prompt（给 Agent 的指令）、verify（检查结果）三部分组成。Runner 在隔离的临时目录中执行每个用例。两层评测互补：ScriptedModel 测试 Agent Loop 逻辑（快速、确定性），真实模型测试 Agent 能力（慢、验证结果不验证过程）。评测让你有信心说"我的 Agent 能工作"——不是因为试了一次没报错，而是因为它通过了一组覆盖核心场景的自动化测试。

---

## 全书回顾

15 章的完整路径：

```
LLM 调用 → 流式处理 → 多轮对话 → 多模型适配 → 测试替身
→ 工具声明 → Agent Loop → 核心工具 → 会话持久化
→ 有状态 Agent → 会话树 → 上下文管理 → 扩展系统
→ CLI 打磨 → 评测
```

从"调一次 API"到"一个完整可用、可测试、可扩展的 Coding Agent"。750 行代码，每一行都有明确的设计理由。你已经理解了 Agent 的全部核心机制——接下来可以用它解决实际问题，或者基于这些原理构建更复杂的系统。
