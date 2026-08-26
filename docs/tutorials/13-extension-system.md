---
title: "扩展系统 — 不修改核心代码添加新能力"
description: "用事件系统和拦截器模式实现权限控制、知识注入等扩展，不污染 Agent Loop 核心"
---

# 第 13 章：扩展系统 — 不污染核心的产品化

> 怎样在不修改 Agent Loop 代码的前提下添加新能力？

## 这一章要解决什么问题？

Agent Loop 的核心代码大约 120 行。如果每加一个功能都要改这 120 行 — 权限控制加几行、日志加几行、知识注入加几行 — 很快它就膨胀到无法维护。

解法是：Agent Loop 保持精简，所有产品化逻辑通过配置注入。本章介绍三种扩展机制：知识注入（给模型更多信息）、行为拦截（在工具执行前后插入逻辑）、事件系统（外部观察 Agent 状态）。

---

## 三种扩展机制

| 机制 | 做什么 | 安全性 |
|------|--------|--------|
| 知识注入 | 把文本拼入 system prompt | 安全 — 只是文本，不执行代码 |
| 行为拦截 | 工具执行前后插入逻辑 | 需要审查 — 能阻止或修改工具行为 |
| 事件系统 | 外部观察状态变化 | 安全 — 只读，不影响执行 |

---

## 知识注入：动态 System Prompt

最简单的扩展方式。给模型额外的知识或指令，让它在特定场景下表现更好。

```typescript
interface AgentConfig {
  // 静态 system prompt
  systemPrompt: string;
  // 动态拼接（每次 LLM 调用前执行）
  getSystemPrompt?: () => string;
}
```

使用时：

```typescript
const config: AgentConfig = {
  systemPrompt: "You are a coding assistant.",
  getSystemPrompt: () => {
    const base = "You are a coding assistant.";
    const cwd = `\nCurrent directory: ${process.cwd()}`;
    const time = `\nCurrent time: ${new Date().toISOString()}`;
    return base + cwd + time;
  },
};
```

Agent Loop 每次调用模型前调用 `getSystemPrompt()`，拿到完整的 system prompt。这让你能注入实时信息（当前目录、时间、项目规范）而不用改 Loop 代码。

实际应用中这就是 Claude Code 的 CLAUDE.md 和 skill 机制 — 把项目规范和工具使用指南注入 system prompt，模型就知道遵循哪些约定。

---

## 行为拦截：beforeToolCall / afterToolCall

工具执行前后的钩子。最重要的用途是权限控制。

```typescript
interface AgentConfig {
  // 工具执行前拦截：返回 false 阻止执行
  beforeToolCall?: (name: string, args: any) => Promise<boolean>;
  // 工具执行后变换：可以修改结果
  afterToolCall?: (name: string, result: ToolResult) => ToolResult;
}
```

### 权限控制示例

```typescript
const config: AgentConfig = {
  beforeToolCall: async (name, args) => {
    // bash 命令需要检查是否危险
    if (name === "bash" && isDangerous(args.command)) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve =>
        rl.question(`⚠️  Run "${args.command}"? [y/N] `, resolve)
      );
      rl.close();
      return answer.toLowerCase() === "y";
    }
    // 其他工具默认允许
    return true;
  },
};

function isDangerous(command: string): boolean {
  const dangerous = ["rm -rf", "sudo", "mkfs", "dd ", "> /dev/"];
  return dangerous.some(d => command.includes(d));
}
```

用户会看到：

```
⚡ bash  rm -rf node_modules
⚠️  Run "rm -rf node_modules"? [y/N]
```

如果用户输入 N，`beforeToolCall` 返回 false。Agent Loop 检测到拦截后，给模型返回一条"工具被用户拒绝"的 toolResult：

```typescript
// Agent Loop 中的集成逻辑
for (const tc of toolCalls) {
  const allowed = await config.beforeToolCall?.(tc.name, tc.arguments) ?? true;

  if (!allowed) {
    messages.push({
      role: "toolResult",
      toolCallId: tc.id,
      toolName: tc.name,
      content: [{ type: "text", text: "Tool call was rejected by user." }],
      isError: true,
      timestamp: Date.now(),
    });
    continue;  // 跳过执行，但 toolResult 仍然配对
  }

  // 正常执行...
}
```

注意：即使工具被拒绝，也要生成一条 toolResult — 保持 toolCallId 配对的不变量。

### 结果变换示例

```typescript
const config: AgentConfig = {
  afterToolCall: (name, result) => {
    // 截断过长的 read_file 结果
    if (name === "read_file" && result.content.length > 50000) {
      return {
        content: result.content.slice(0, 50000) + "\n\n[Output truncated]",
        isError: false,
      };
    }
    return result;
  },
};
```

`afterToolCall` 能修改工具返回给模型的结果。用途：截断、脱敏（隐藏 API key）、增强（附加额外信息）。

---

## 事件系统

让外部代码观察 Agent 的运行过程，不干预执行。

```typescript
interface AgentConfig {
  onText?: (text: string) => void;           // 流式文本到达
  onToolCall?: (name: string, args: any) => void;  // 工具调用开始
  onToolResult?: (name: string, result: ToolResult) => void;  // 工具执行完成
  onThinking?: (text: string) => void;       // 思考内容
}
```

这些回调在第 07 章已经见过了。它们就是最简单的事件系统 — Agent Loop 在关键时刻调用对应回调，外部监听者做自己的事（显示 UI、写日志、更新进度条）。

---

## 信任边界

三种扩展机制有不同的信任等级：

**知识注入 — 安全**。只是文本，模型读完自己决定怎么做。注入错误的知识最多让模型表现差，不会直接造成破坏。

**事件系统 — 安全**。只读观察，不能影响执行流程。

**行为拦截 — 需要审查**。`beforeToolCall` 能阻止工具执行，`afterToolCall` 能修改结果。写得不好会让 Agent 陷入死循环（总是拒绝 → 模型重试 → 再拒绝）。

---

## 完整的 AgentConfig

把所有扩展点放在一起看：

```typescript
interface AgentConfig {
  // ─── 核心配置 ───
  model: Model<any>;
  streamFn: StreamFunction;
  tools: MiniTool[];
  systemPrompt: string;

  // ─── 知识注入 ───
  getSystemPrompt?: () => string;

  // ─── 行为拦截 ───
  beforeToolCall?: (name: string, args: any) => Promise<boolean>;
  afterToolCall?: (name: string, result: ToolResult) => ToolResult;

  // ─── 事件系统 ───
  onText?: (text: string) => void;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
  onThinking?: (text: string) => void;
}
```

Agent Loop 核心代码保持不变（~120 行）。所有产品化逻辑 — 权限确认、输出截断、日志记录、UI 更新 — 都通过这些配置点注入。

---

## 设计原则

**不修改核心，通过配置扩展。** 这有几个好处：

1. Agent Loop 容易理解 — 120 行代码做一件事
2. 功能可以独立开关 — 不要权限控制？不传 beforeToolCall 就行
3. 容易测试 — 核心逻辑和扩展逻辑分开验证
4. 多实例可以有不同配置 — 同一个 Loop 代码，配出不同行为的 Agent

---

## 小结

三种扩展机制让 Agent Loop 保持精简的同时支持产品化：知识注入通过 `getSystemPrompt` 动态拼接 system prompt，行为拦截通过 `beforeToolCall`/`afterToolCall` 在工具执行前后插入权限控制和结果变换，事件系统通过回调让外部观察运行状态。所有扩展通过 AgentConfig 注入，Agent Loop 核心代码不需要修改。

---

## 下一章

所有的功能模块都写完了 — Agent Loop、工具、持久化、上下文管理、扩展系统。下一章把它们组装成一个完整的 CLI 产品：命令行参数、彩色输出、命令系统、启动 banner。从 demo 到可用。

→ [第 14 章：打磨 — 从 Demo 到可用产品](./14-polish.md)
