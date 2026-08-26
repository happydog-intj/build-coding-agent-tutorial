---
title: "Hooks 事件系统 — 生命周期扩展"
description: "在 Agent 生命周期的关键节点注入自定义逻辑：事件类型、处理器模式、声明式配置"
---

# 第 19 章：Hooks 事件系统 — 生命周期扩展

> Agent Loop 是封闭的循环。Hooks 在循环的关键节点打开"窗口"，让外部逻辑可以观察、干预、甚至改变 Agent 的行为——而不需要修改核心代码。

## 这一章要解决什么问题？

第 13 章讲了扩展系统的基本架构，第 18 章讲了权限拦截。但还有更多需求无法用权限系统覆盖：

- 每次工具调用后自动写审计日志
- Agent 输出代码后自动运行 linter
- 会话结束时自动生成摘要
- 上下文压缩前把关键信息提取出来

这些需求的共同特征：**在特定时间点执行自定义逻辑**。Hooks 系统提供的就是这些"时间点"的标准接口。

---

## 事件类型

Agent 生命周期中的关键事件：

```typescript
type HookEvent =
  | "PreToolUse"      // 工具执行前（可拦截）
  | "PostToolUse"     // 工具执行后（可观察结果）
  | "PreSampling"     // 发送给 LLM 之前（可修改 context）
  | "PostSampling"    // LLM 返回之后（可观察输出）
  | "Stop"            // Agent 循环结束时
  | "Start"           // Agent 循环开始时
  | "PreCompact"      // 上下文压缩前
  | "Error";          // 发生错误时
```

每个事件携带不同的上下文数据：

```typescript
interface HookContext {
  event: HookEvent;
  tool?: string;           // PreToolUse / PostToolUse
  args?: Record<string, unknown>;  // 工具参数
  result?: ToolResult;     // PostToolUse 的结果
  messages?: Message[];    // PreSampling 的完整上下文
  response?: string;       // PostSampling 的模型输出
  error?: Error;           // Error 事件
  sessionId?: string;      // 当前会话 ID
}
```

---

## 处理器类型

同一个事件可以有多种方式响应。定义几种处理器类型：

```typescript
type HookHandler =
  | CommandHandler    // 执行 Shell 命令
  | HttpHandler       // 发送 HTTP 请求（Webhook）
  | FunctionHandler;  // 内联函数

interface CommandHandler {
  type: "command";
  command: string;    // Shell 命令，支持模板变量
}

interface HttpHandler {
  type: "http";
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
}

interface FunctionHandler {
  type: "function";
  fn: (ctx: HookContext) => Promise<HookResult>;
}
```

处理器的返回值决定后续行为：

```typescript
interface HookResult {
  action: "continue" | "block" | "modify";
  message?: string;        // block 时的原因
  modifications?: {        // modify 时的变更
    args?: Record<string, unknown>;
    messages?: Message[];
  };
}
```

---

## 声明式配置

Hooks 的核心设计原则：**不需要写代码，JSON 配置即可**。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "handlers": [
          {
            "type": "command",
            "command": "echo '[AUDIT] bash: ${args.command}' >> ~/.agent/audit.log"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "write_file|edit_file",
        "handlers": [
          {
            "type": "command",
            "command": "npx eslint --fix ${args.path} 2>/dev/null || true"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "handlers": [
          {
            "type": "http",
            "url": "https://hooks.slack.com/services/xxx",
            "method": "POST"
          }
        ]
      }
    ]
  }
}
```

这段配置实现了三个功能：
1. 每次执行 bash 工具时写审计日志
2. 每次写/编辑文件后自动运行 ESLint 修复
3. Agent 结束时发 Slack 通知

---

## Hook 引擎实现

```typescript
interface HookRegistration {
  event: HookEvent;
  matcher: string;          // 工具名匹配模式，"*" 匹配所有
  handlers: HookHandler[];
}

class HookEngine {
  private registrations: HookRegistration[] = [];

  register(reg: HookRegistration): void {
    this.registrations.push(reg);
  }

  async emit(ctx: HookContext): Promise<HookResult> {
    const matched = this.registrations.filter(
      r => r.event === ctx.event && this.matches(r.matcher, ctx)
    );

    for (const reg of matched) {
      for (const handler of reg.handlers) {
        const result = await this.executeHandler(handler, ctx);

        // block 立即终止
        if (result.action === "block") {
          return result;
        }
        // modify 更新上下文，继续执行后续 handler
        if (result.action === "modify" && result.modifications) {
          Object.assign(ctx, result.modifications);
        }
      }
    }

    return { action: "continue" };
  }

  private matches(matcher: string, ctx: HookContext): boolean {
    if (matcher === "*") return true;
    const patterns = matcher.split("|");
    return patterns.some(p => ctx.tool === p || minimatch(ctx.tool ?? "", p));
  }

  private async executeHandler(
    handler: HookHandler,
    ctx: HookContext
  ): Promise<HookResult> {
    switch (handler.type) {
      case "command":
        return this.execCommand(handler, ctx);
      case "http":
        return this.execHttp(handler, ctx);
      case "function":
        return handler.fn(ctx);
    }
  }

  private async execCommand(
    handler: CommandHandler,
    ctx: HookContext
  ): Promise<HookResult> {
    const command = this.interpolate(handler.command, ctx);
    try {
      execSync(command, { timeout: 10_000, stdio: "pipe" });
      return { action: "continue" };
    } catch {
      return { action: "continue" }; // 命令失败不阻断 Agent
    }
  }

  private async execHttp(
    handler: HttpHandler,
    ctx: HookContext
  ): Promise<HookResult> {
    try {
      await fetch(handler.url, {
        method: handler.method ?? "POST",
        headers: { "Content-Type": "application/json", ...handler.headers },
        body: JSON.stringify(ctx),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Webhook 失败不阻断 Agent
    }
    return { action: "continue" };
  }

  private interpolate(template: string, ctx: HookContext): string {
    return template.replace(/\$\{(\w+(?:\.\w+)*)\}/g, (_, path) => {
      const value = path.split(".").reduce((obj: any, key: string) => obj?.[key], ctx);
      return String(value ?? "");
    });
  }
}
```

---

## 集成到 Agent Loop

在 Agent Loop 的关键位置插入 `hookEngine.emit()`：

```typescript
async function* agentLoop(prompt: string, messages: Message[], config: AgentConfig) {
  const hooks = config.hookEngine;

  // Start 事件
  await hooks.emit({ event: "Start", sessionId: config.sessionId });

  messages.push({ role: "user", content: prompt });

  while (true) {
    // PreSampling 事件——可以修改 messages
    const preSample = await hooks.emit({ event: "PreSampling", messages });
    if (preSample.modifications?.messages) {
      messages = preSample.modifications.messages;
    }

    const response = await streamFn(config.model, messages);

    // PostSampling 事件
    await hooks.emit({ event: "PostSampling", response: response.text });

    if (response.stopReason !== "tool_use") {
      break;
    }

    for (const toolCall of response.toolCalls) {
      // PreToolUse 事件——可以拦截
      const preResult = await hooks.emit({
        event: "PreToolUse",
        tool: toolCall.name,
        args: toolCall.arguments,
      });

      let toolResult: ToolResult;
      if (preResult.action === "block") {
        toolResult = { content: `Blocked: ${preResult.message}`, isError: true };
      } else {
        toolResult = await executeTool(toolCall, config.tools);
      }

      // PostToolUse 事件——可以观察结果
      await hooks.emit({
        event: "PostToolUse",
        tool: toolCall.name,
        args: toolCall.arguments,
        result: toolResult,
      });
    }
  }

  // Stop 事件
  await hooks.emit({ event: "Stop", sessionId: config.sessionId });
}
```

---

## 实用 Hook 示例

### 自动格式化

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "write_file|edit_file",
      "handlers": [{
        "type": "command",
        "command": "prettier --write ${args.path} 2>/dev/null || true"
      }]
    }]
  }
}
```

### 敏感信息过滤

```typescript
hookEngine.register({
  event: "PreToolUse",
  matcher: "bash",
  handlers: [{
    type: "function",
    fn: async (ctx) => {
      const cmd = String(ctx.args?.command ?? "");
      if (cmd.includes("$API_KEY") || cmd.includes("$SECRET")) {
        return { action: "block", message: "命令包含敏感环境变量" };
      }
      return { action: "continue" };
    },
  }],
});
```

### 执行耗时追踪

```typescript
hookEngine.register({
  event: "PostToolUse",
  matcher: "*",
  handlers: [{
    type: "function",
    fn: async (ctx) => {
      const duration = Date.now() - (ctx as any)._startTime;
      if (duration > 30_000) {
        console.warn(`⚠️  ${ctx.tool} 执行超过 30 秒 (${duration}ms)`);
      }
      return { action: "continue" };
    },
  }],
});
```

---

## 设计要点

| 要点 | 说明 |
|------|------|
| 不阻断 | Handler 异常不应导致 Agent 崩溃，catch 后继续 |
| 超时 | Shell 命令和 HTTP 都设超时，防止 Hook 卡住主循环 |
| 顺序执行 | 同一事件的多个 Handler 按注册顺序执行，block 立即终止 |
| 声明式优先 | JSON 配置覆盖 80% 场景，代码 Hook 用于复杂逻辑 |
| 隔离 | Hook 不应修改 Agent 核心状态，只能通过返回值影响行为 |

---

## 小结

Hooks 是 Agent 的可观测/可干预层。通过在生命周期关键节点（PreToolUse / PostToolUse / Start / Stop 等）广播事件，外部逻辑可以观察 Agent 行为、拦截危险操作、自动执行后处理。三种处理器类型覆盖不同场景：command 适合简单的 Shell 脚本，http 适合外部服务通知，function 适合复杂判断逻辑。声明式 JSON 配置让非开发者也能定制 Agent 行为。核心原则是"不侵入、不阻断"——Hook 失败不应影响 Agent 主流程。
