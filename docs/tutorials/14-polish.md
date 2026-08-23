# 第 14 章：打磨 — 从 Demo 到可用产品

> 功能都有了，但用起来体验还差一截。怎么从"能跑"变成"好用"？

## 这一章要解决什么问题？

前面 13 章把所有核心功能写完了：Agent Loop、工具、持久化、上下文管理、扩展系统。但打开终端一看——没有提示、没有颜色、不知道在用哪个模型、不知道怎么退出。用户体验和一个可以交付使用的产品之间，还差"打磨"这一步。

这一章用 mini-pi-coding-agent 的实际 `index.ts` 来展示产品化的几个关键点：启动 Banner、ANSI 颜色、命令系统、参数解析、工具调用的可视化。

---

## CLI 参数解析

第一个问题：用户怎么指定使用哪个模型？怎么恢复之前的会话？

```typescript
const args = process.argv.slice(2);
const modelArg = args.find(a => a.startsWith("--model="))?.split("=")[1];
const resumeArg = args.find(a => a.startsWith("--resume="))?.split("=")[1];
```

不需要引入 `commander` 或 `yargs` — 对于只有两三个参数的小工具，手动解析 `process.argv` 最简单。

```bash
# 默认模型
npx tsx src/index.ts

# 指定模型
npx tsx src/index.ts --model=claude-sonnet-4-20250514

# 恢复会话
npx tsx src/index.ts --resume=2024-06-15_143022_a7x2
```

---

## 启动 Banner

用户启动程序后需要立即知道三件事：这是什么、在用什么模型、怎么退出。

```typescript
console.log("\x1b[36m╭─────────────────────────────────────╮\x1b[0m");
console.log("\x1b[36m│\x1b[0m  \x1b[1mMini Pi Coding Agent\x1b[0m              \x1b[36m│\x1b[0m");
console.log("\x1b[36m│\x1b[0m  Model: \x1b[33m%-27s\x1b[0m \x1b[36m│\x1b[0m", model.id);
console.log("\x1b[36m│\x1b[0m  Tools: read, write, edit, bash     \x1b[36m│\x1b[0m");
console.log("\x1b[36m│\x1b[0m  Type /quit to exit                 \x1b[36m│\x1b[0m");
console.log("\x1b[36m╰─────────────────────────────────────╯\x1b[0m");
```

几个设计细节：

1. **用 box-drawing 字符**画边框（`╭╮╰╯│─`），比 `+---+` 更美观
2. **显示模型 ID** — 用户需要确认自己在用正确的模型
3. **显示可用工具列表** — 用户知道 Agent 的能力范围
4. **显示退出方式** — 新用户不会被"困住"

---

## ANSI 转义序列

终端颜色和样式通过 ANSI 转义序列实现。几个常用的：

```
\x1b[0m    — 重置所有样式
\x1b[1m    — 加粗
\x1b[31m   — 红色（错误）
\x1b[32m   — 绿色（成功）
\x1b[33m   — 黄色（工具名称、警告）
\x1b[36m   — 青色（UI 元素）
\x1b[90m   — 暗灰色（次要信息）
```

在代码中的使用模式：

```typescript
// 工具调用开始 — 黄色名称 + 灰色参数
console.log(`\n\x1b[33m⚡ ${name}\x1b[0m \x1b[90m${formatToolArgs(name, args)}\x1b[0m`);

// 工具成功 — 绿色 ✓
console.log(`\x1b[32m✓ ${name}\x1b[0m \x1b[90m${preview}\x1b[0m`);

// 工具失败 — 红色 ✗
console.log(`\x1b[31m✗ ${name} failed\x1b[0m`);

// 模型思考内容 — 灰色（不抢注意力）
process.stdout.write(`\x1b[90m${text}\x1b[0m`);
```

颜色的作用不是装饰——它建立视觉层次。用户扫一眼就能区分：模型输出（默认色）、工具操作（黄+绿/红）、系统信息（灰）、错误（红）。

---

## 斜杠命令

交互式 CLI 需要一些"元操作"——不是发给 Agent 处理的任务，而是控制 CLI 自身行为的命令。

```typescript
while (true) {
  const input = await question("\x1b[36m> \x1b[0m");
  const trimmed = input.trim();

  if (!trimmed) continue;                              // 空输入跳过
  if (trimmed === "/quit" || trimmed === "/exit") break;  // 退出
  if (trimmed === "/clear") {                          // 清空会话
    messages = [];
    console.log("\x1b[90mSession cleared\x1b[0m\n");
    continue;
  }
  if (trimmed === "/session") {                        // 查看会话信息
    console.log(`\x1b[90mMessages: ${messages.length} | File: ${sessionFile}\x1b[0m\n`);
    continue;
  }

  // 不是命令，发给 Agent 处理
  await runAgent(trimmed, messages, config);
}
```

设计选择：用 `/` 前缀区分命令和自然语言。这是 CLI Agent 的通用约定（Claude Code、Cursor 都用这种方式）。

---

## 工具调用可视化

Agent 运行时，用户需要知道正在发生什么——否则就是对着空屏幕等，不知道进度。

```typescript
const config: AgentConfig = {
  onToolCall: (name, args) => {
    console.log(`\n\x1b[33m⚡ ${name}\x1b[0m \x1b[90m${formatToolArgs(name, args)}\x1b[0m`);
  },
  onToolResult: (name, result) => {
    if (result.isError) {
      console.log(`\x1b[31m✗ ${name} failed\x1b[0m`);
    } else {
      const preview = result.content.slice(0, 100).replace(/\n/g, " ");
      console.log(`\x1b[32m✓ ${name}\x1b[0m \x1b[90m${preview}${result.content.length > 100 ? "..." : ""}\x1b[0m`);
    }
    console.log();
  },
};
```

展示效果：

```
> 帮我看看 package.json

⚡ read_file package.json
✓ read_file {"name":"mini-pi-coding-agent","version":"1.0.0","description":"A minimal coding agent...

这是一个 TypeScript 项目...
```

关键设计：

1. **工具名 + 关键参数**，不是整个 args JSON（太长了）
2. **结果只显示预览**（前 100 字符），不是完整输出
3. **成功/失败**用不同颜色和符号（✓ / ✗）

`formatToolArgs` 针对每个工具提取最有用的参数：

```typescript
function formatToolArgs(name: string, args: any): string {
  switch (name) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return args.path ?? "";        // 文件工具：只显示路径
    case "bash":
      return args.command?.slice(0, 60) ?? "";  // bash：只显示命令（截断）
    default:
      return JSON.stringify(args).slice(0, 60);
  }
}
```

---

## 错误处理的完整链路

错误可能在不同层级发生。每个层级的处理方式：

```typescript
// 1. Provider 初始化失败 — 致命，直接退出
try {
  providerSetup = setupProvider(modelArg);
} catch (err: any) {
  console.error(`\x1b[31m${err.message}\x1b[0m`);
  process.exit(1);
}

// 2. Agent 运行中的错误 — 由 Agent Loop 内部处理（不抛出）
//    模型返回 error → stopReason = "error"，循环结束
//    工具执行失败 → isError = true，模型看到错误并决定下一步

// 3. 未预期的致命错误 — 顶层 catch
main().catch((err) => {
  console.error("\x1b[31mFatal error:\x1b[0m", err.message);
  process.exit(1);
});
```

三层错误处理，对应三种严重程度：配置错误（无法启动）、运行时错误（Agent 自行处理）、未知错误（兜底）。

---

## 会话恢复的用户提示

恢复已有会话时，告诉用户：

```typescript
if (messages.length > 0) {
  console.log(`\x1b[90mResumed session with ${messages.length} messages\x1b[0m\n`);
}
```

一句话就够了。用户知道自己用了 `--resume` 参数，只需要确认恢复成功。

---

## 全局结构

`index.ts` 的完整结构很清晰：

```
1. 常量（SYSTEM_PROMPT）
2. main 函数
   2.1 解析 CLI 参数
   2.2 初始化 provider
   2.3 加载/创建会话
   2.4 打印 Banner
   2.5 组装 AgentConfig
   2.6 readline 循环
     - 斜杠命令处理
     - 调用 runAgent
     - 持久化新消息
   2.7 退出
3. 辅助函数（formatToolArgs）
4. 顶层 catch
```

每个部分职责单一。`main()` 是把所有模块组装起来的"胶水层"——provider 模块负责模型、session 模块负责存储、agent-loop 模块负责核心逻辑、tools 目录负责具体工具。`index.ts` 只做组装和 UI。

---

## 小结

产品化打磨不是可选的。启动 Banner 告诉用户关键信息（模型、工具、退出方式），ANSI 颜色建立视觉层次（正文/工具/系统/错误），斜杠命令提供"元操作"（退出/清空/查看状态），工具调用可视化让用户在 Agent 运行时知道进度。所有这些都不修改核心逻辑——它们通过 AgentConfig 的事件回调和外层 UI 代码实现。

---

## 下一章

Agent 写完了，能跑了，用起来也顺手了。但"能跑"不等于"正确"。怎么证明你的 Agent 确实能解决编程任务？最后一章介绍评测——用自动化测试验证 Agent 的能力。

→ [第 15 章：评测 — 证明你的 Agent 能工作](./15-evaluation.md)
