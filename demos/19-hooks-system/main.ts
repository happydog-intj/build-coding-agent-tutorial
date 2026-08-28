/**
 * 第 19 章：Hooks 事件系统 — 生命周期扩展
 *
 * 用 ScriptedModel 模拟工具调用，演示 Hooks 如何扩展 Agent 行为：
 * 1. Hook 事件：PreToolUse / PostToolUse / Stop
 * 2. Handler 类型：command（shell）/ function（内联）
 * 3. Hook 结果：continue / block / modify
 * 4. 声明式 Hook 配置（JSON）
 * 5. Hook 引擎执行与结果应用
 *
 * 无需 API key！
 *
 * 运行方式：
 *   npx tsx main.ts
 */

import type { AssistantMessage, AssistantMessageEventStream, Context } from "@earendil-works/pi-ai";

// ─── Hook 类型定义 ─────────────────────────────────────────────────────────────

type HookEvent = "PreToolUse" | "PostToolUse" | "Stop";
type HookResultAction = "continue" | "block" | "modify";

interface HookResult {
  action: HookResultAction;
  message?: string;
  modified?: any;
}

interface HookHandler {
  type: "command" | "function";
  name: string;
  matcher?: string;  // 匹配工具名的 glob
  command?: string;  // type=command 时的 shell 命令
  fn?: (payload: any) => HookResult;  // type=function 时的内联函数
}

interface HookConfig {
  event: HookEvent;
  handlers: HookHandler[];
}

// ─── Hook 引擎 ─────────────────────────────────────────────────────────────────

class HookEngine {
  private hooks: HookConfig[] = [];
  private auditLog: string[] = [];

  register(config: HookConfig) {
    this.hooks.push(config);
  }

  getAuditLog(): string[] {
    return [...this.auditLog];
  }

  async execute(event: HookEvent, payload: any): Promise<HookResult> {
    const configs = this.hooks.filter(h => h.event === event);
    let finalResult: HookResult = { action: "continue" };

    for (const config of configs) {
      for (const handler of config.handlers) {
        // 检查 matcher
        if (handler.matcher && payload.toolName) {
          if (!matchGlob(handler.matcher, payload.toolName)) continue;
        }

        let result: HookResult;

        if (handler.type === "function" && handler.fn) {
          result = handler.fn(payload);
        } else if (handler.type === "command" && handler.command) {
          // 模拟 shell 命令执行（真实场景中会 spawn 进程）
          result = simulateCommand(handler.command, payload);
        } else {
          result = { action: "continue" };
        }

        this.auditLog.push(`[${event}] ${handler.name}: ${result.action}${result.message ? ` — ${result.message}` : ""}`);
        printHookFiring(event, handler.name, result);

        // block 立即生效，modify 覆盖 payload
        if (result.action === "block") return result;
        if (result.action === "modify") {
          finalResult = result;
          Object.assign(payload, result.modified ?? {});
        }
      }
    }

    return finalResult;
  }
}

function matchGlob(pattern: string, value: string): boolean {
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return regex.test(value);
}

function simulateCommand(cmd: string, payload: any): HookResult {
  // 模拟：echo 命令总是返回 continue
  return { action: "continue", message: `executed: ${cmd}` };
}

// ─── ScriptedModel ─────────────────────────────────────────────────────────────

function createScriptedModel(responses: AssistantMessage[]) {
  let cursor = 0;
  return {
    next(ctx: Context): AssistantMessageEventStream {
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

// ─── 辅助输出 ──────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[90m",
  magenta: "\x1b[35m",
};

function printHookFiring(event: HookEvent, handlerName: string, result: HookResult) {
  const icon = result.action === "continue" ? `${C.green}→`
    : result.action === "block" ? `${C.red}✗`
    : `${C.magenta}~`;
  console.log(`  ${icon} [${event}] ${handlerName}: ${result.action}${C.reset}${result.message ? ` ${C.dim}(${result.message})${C.reset}` : ""}`);
}

// ─── 场景演示 ──────────────────────────────────────────────────────────────────

console.log(`${C.cyan}第 19 章 Demo：Hooks 事件系统${C.reset}`);
console.log(`${C.dim}Agent 生命周期的可编程扩展点${C.reset}\n`);

// ─── 构建 Hook 配置 ───
const engine = new HookEngine();

// Hook 1: PreToolUse 审计 — 记录所有 bash 命令
engine.register({
  event: "PreToolUse",
  handlers: [{
    type: "function",
    name: "audit-logger",
    matcher: "bash",
    fn: (payload) => {
      // 记录到审计日志（引擎内部的 auditLog）
      return { action: "continue", message: `记录命令: ${payload.command ?? "N/A"}` };
    },
  }],
});

// Hook 2: PreToolUse 过滤 — 拦截含敏感词的命令
engine.register({
  event: "PreToolUse",
  handlers: [{
    type: "function",
    name: "secret-filter",
    matcher: "bash",
    fn: (payload) => {
      const cmd: string = payload.command ?? "";
      const secrets = ["password", "token", "secret", "API_KEY"];
      const found = secrets.find(s => cmd.toLowerCase().includes(s.toLowerCase()));
      if (found) {
        return { action: "block", message: `命令包含敏感词「${found}」` };
      }
      return { action: "continue" };
    },
  }],
});

// Hook 3: PostToolUse 自动格式化 — 写入文件后追加换行
engine.register({
  event: "PostToolUse",
  handlers: [{
    type: "function",
    name: "auto-newline",
    matcher: "write_file",
    fn: (payload) => {
      const content = payload.result ?? "";
      if (!content.endsWith("\n")) {
        return { action: "modify", message: "追加尾部换行", modified: { result: content + "\n" } };
      }
      return { action: "continue", message: "已有换行，无需修改" };
    },
  }],
});

// Hook 4: Stop 通知 — 会话结束时输出摘要
engine.register({
  event: "Stop",
  handlers: [{
    type: "function",
    name: "session-summary",
    fn: (payload) => {
      return { action: "continue", message: `会话结束，共 ${payload.toolCallCount} 次工具调用` };
    },
  }],
});

// ─── 场景 1：审计 Hook ───
{
  console.log(`${C.yellow}═══ 场景 1：PreToolUse 审计 — 记录 bash 命令 ═══${C.reset}\n`);

  await engine.execute("PreToolUse", { toolName: "bash", command: "npm test" });
  await engine.execute("PreToolUse", { toolName: "bash", command: "git status" });
  await engine.execute("PreToolUse", { toolName: "read_file", path: "src/app.ts" });

  console.log(`\n  ${C.dim}（read_file 不匹配 bash matcher，审计 Hook 跳过）${C.reset}\n`);
}

// ─── 场景 2：过滤 Hook — 拦截含敏感词的命令 ───
{
  console.log(`${C.yellow}═══ 场景 2：PreToolUse 过滤 — 拦截含 secret 的命令 ═══${C.reset}\n`);

  await engine.execute("PreToolUse", { toolName: "bash", command: "echo $API_KEY" });
  await engine.execute("PreToolUse", { toolName: "bash", command: "export password=123" });
  await engine.execute("PreToolUse", { toolName: "bash", command: "npm install lodash" });

  console.log();
}

// ─── 场景 3：PostToolUse 修改 Hook ───
{
  console.log(`${C.yellow}═══ 场景 3：PostToolUse 自动格式化 — 追加换行 ═══${C.reset}\n`);

  await engine.execute("PostToolUse", { toolName: "write_file", result: "const x = 1;" });
  await engine.execute("PostToolUse", { toolName: "write_file", result: "const y = 2;\n" });

  console.log();
}

// ─── 场景 4：Stop Hook — 会话结束通知 ───
{
  console.log(`${C.yellow}═══ 场景 4：Stop 通知 — 会话结束摘要 ═══${C.reset}\n`);

  await engine.execute("Stop", { toolCallCount: 7, duration: "2m 30s" });

  console.log();
}

// ─── 声明式配置示例 ───
{
  console.log(`${C.yellow}═══ 附录：声明式 Hook 配置（settings.json 格式） ═══${C.reset}\n`);

  const configExample = {
    hooks: {
      PreToolUse: [
        { matcher: "bash", command: "echo 'audit: $TOOL_INPUT' >> /tmp/audit.log" },
        { matcher: "bash", command: "if echo '$TOOL_INPUT' | grep -qi 'password'; then exit 2; fi" },
      ],
      PostToolUse: [
        { matcher: "write_file", command: "prettier --write $FILE_PATH" },
      ],
      Stop: [
        { command: "echo '会话结束' | notify-send" },
      ],
    },
  };

  console.log(`  ${C.dim}${JSON.stringify(configExample, null, 2).split("\n").join(`\n  `)}${C.reset}`);
  console.log();
}

// ─── 审计日志输出 ───
{
  console.log(`${C.yellow}═══ 审计日志回放 ═══${C.reset}\n`);
  const log = engine.getAuditLog();
  for (const entry of log) {
    console.log(`  ${C.dim}${entry}${C.reset}`);
  }
  console.log();
}

// ─── 总结 ────────────────────────────────────────────────────────────────────
console.log(`${C.yellow}═══ Hooks 系统总结 ═══${C.reset}\n`);
console.log("  事件          触发时机              典型用途");
console.log("  ─────────────────────────────────────────────────────────");
console.log("  PreToolUse    工具执行前            审计/过滤/参数修改");
console.log("  PostToolUse   工具执行后            自动格式化/结果验证");
console.log("  Stop          Agent 会话结束        通知/摘要/清理");
console.log();
console.log("  结果动作      含义");
console.log("  ─────────────────────────────────────────────────────────");
console.log("  continue      放行，继续执行");
console.log("  block         拦截，工具不执行（仅 PreToolUse）");
console.log("  modify        修改 payload 后继续");
console.log();
console.log(`${C.dim}关键认知：Hooks = 不改代码的行为扩展。审计、安全、格式化都是 Hook 的用武之地。${C.reset}\n`);

