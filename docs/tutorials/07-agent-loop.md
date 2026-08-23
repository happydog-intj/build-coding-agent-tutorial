# 第 07 章：Agent Loop 循环引擎 — 从一次调用到自主循环

> 模型需要连续调用多个工具——先读文件、再改代码、再跑测试——怎么自动化这个过程？

## 这一章要解决什么问题？

上一章手动完成了一次工具调用：检查 toolCall → 执行 → 构造 toolResult → 再调模型。但如果模型需要连续调 5 次工具呢？你不可能每次都手写这个流程。

解决方案是一个 while 循环：持续"调用模型 → 检查有没有 toolCall → 有就执行 → 把结果传回"，直到模型不再调用工具为止。这个循环就是 Agent Loop，所有 Coding Agent 的核心引擎。

---

## Agent Loop 的伪代码

先看最简洁的抽象：

```
while (true) {
  response = callModel(messages)
  if (response has no toolCalls) break   // 模型完成了
  for (each toolCall in response) {
    result = execute(toolCall)
    messages.push(result)
  }
}
```

三个关键判断：
- 有 toolCall → 继续循环（模型还要做事）
- 没有 toolCall → 退出循环（模型认为任务完成）
- stopReason 是 error → 退出循环（出错了）

Claude Code、Cursor、Cline 的核心都是这个 while 循环。区别只在于工具集、权限控制、UI 层的复杂度。

---

## 逐段拆解 agent-loop.ts

让我们看 `src/agent-loop.ts` 的 `runAgent` 函数，这是我们项目的完整实现：

### 第 1 步：添加用户消息，准备工具 schema

```typescript
export async function runAgent(
  prompt: string,
  messages: Message[],
  config: AgentConfig
): Promise<Message[]> {
  // 添加用户消息
  const userMsg: Message = { role: "user", content: prompt, timestamp: Date.now() };
  messages.push(userMsg);

  // 将 MiniTool 的 schema 部分提取出来（execute 不传给模型）
  const toolSchemas: Tool[] = config.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as any,
  }));
```

`MiniTool` 包含 schema + execute，但传给模型的 `Context.tools` 只需要 schema。`execute` 留在程序这边用。

### 第 2 步：主循环开始 — 调用 LLM

```typescript
  while (true) {
    // 构建 Context
    const context: Context = {
      systemPrompt: config.systemPrompt,
      messages,
      tools: toolSchemas,
    };

    // 调用 LLM（流式）
    const stream = config.streamFn(config.model, context);
    const assistantMsg = await consumeStream(stream, config);
    messages.push(assistantMsg);
```

每次循环都重新构建 Context（因为 messages 在增长），调用模型拿到回复，追加到 messages。

### 第 3 步：检查错误

```typescript
    // 错误或中断 → 退出循环
    if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
      if (assistantMsg.errorMessage) {
        config.onText?.(`\n[Error: ${assistantMsg.errorMessage}]\n`);
      }
      break;
    }
```

注意：LLM 调用**不 throw**。即使网络超时或 API 报错，`consumeStream` 也不会抛异常——错误通过 `stopReason` 字段表达。这是设计原则 #1。

### 第 4 步：检查 toolCall — 循环的关键判断

```typescript
    // 提取 tool calls
    const toolCalls = assistantMsg.content.filter(
      (c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall"
    );
    if (toolCalls.length === 0) break; // 无工具调用 = LLM 已完成
```

如果 content 里没有 toolCall，模型认为任务完成了——退出循环。

### 第 5 步：执行工具

```typescript
    for (const tc of toolCalls) {
      config.onToolCall?.(tc.name, tc.arguments);

      const tool = config.tools.find((t) => t.name === tc.name);
      let result: ToolResult;

      if (!tool) {
        // 模型调了一个不存在的工具
        result = {
          content: `Unknown tool: "${tc.name}". Available: ${config.tools.map((t) => t.name).join(", ")}`,
          isError: true,
        };
      } else {
        try {
          result = await tool.execute(tc.arguments);
        } catch (err) {
          // 工具抛异常 → 转为错误内容
          result = {
            content: `Error executing ${tc.name}: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      }
```

工具找不到？返回错误内容告诉模型有哪些工具可用。工具执行抛异常？catch 住，转为错误内容。**工具调用永远不会让循环崩溃**。

### 第 6 步：构造 toolResult，回到循环顶部

```typescript
      config.onToolResult?.(tc.name, result);

      const toolResultMsg: Message = {
        role: "toolResult",
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: "text", text: result.content }],
        isError: result.isError ?? false,
        timestamp: Date.now(),
      };
      messages.push(toolResultMsg);
    }
    // 回到循环顶部 → 带着工具结果再次调用 LLM
  }

  return messages;
}
```

toolResult 追加到 messages 后，循环回到顶部，下一次 LLM 调用就能看到工具的执行结果。

---

## 设计原则 #1：LLM 调用永不 throw

```typescript
// ✗ 危险的做法
const response = await fetch(url);  // 网络错误 → throw → 循环崩溃
const data = await response.json();

// ✓ pi-ai 的做法
const stream = config.streamFn(model, context);  // 永不 throw
const msg = await consumeStream(stream, config);  // 错误编码在 msg.stopReason
if (msg.stopReason === "error") break;            // 优雅退出
```

如果 LLM 调用可能抛异常，你得在 while 循环里加 try-catch，错误恢复逻辑会变得很复杂。让 stream 层把错误编码在返回值里，循环逻辑保持干净。

---

## 设计原则 #2：工具失败返回错误内容

```typescript
// ✗ 会让循环崩溃
async execute(params) {
  const content = await readFile(params.path, "utf-8");  // ENOENT → throw!
  return { content };
}

// ✓ 错误变成内容，让 LLM 自己处理
async execute(params) {
  try {
    const content = await readFile(params.path, "utf-8");
    return { content };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { content: `File not found: ${params.path}`, isError: true };
    }
    return { content: `Cannot read: ${err.message}`, isError: true };
  }
}
```

模型看到 `"File not found: config.yaml"` 后，通常会尝试用 `bash` 工具执行 `ls` 看看有哪些文件，然后换一个正确的路径再试。**把错误当作信息传递给模型，让模型决定怎么处理**，比程序自己崩溃要好得多。

---

## 与 Pi 完整版的对比

我们的简化版 ~120 行，Pi 完整版 ~500 行。差在哪里？

| 简化版 | Pi 完整版 | 为什么需要 |
|--------|----------|-----------|
| 单循环 | 双循环（内层 tool + 外层 follow-up） | 自主多步操作后还能继续对话 |
| 顺序执行工具 | 并行执行工具 | 模型同时调多个工具时效率更高 |
| 无拦截 | beforeToolCall / afterToolCall | 权限控制（危险命令要用户确认） |
| 无 steering | getSteeringMessages | 运行中注入新指令 |
| 无 context 管理 | transformContext | 上下文窗口超限时截断 |

简化版足够理解核心原理。产品级的 Agent 需要这些额外能力，但它们都是在 while 循环基础上的增强，不改变核心逻辑。

---

## 一次完整的循环跟踪

最后我们看一下用户说"创建 hello.ts 并运行"，Agent Loop 的执行轨迹：

```
循环 #1:
  messages: [user("创建 hello.ts 并运行")]
  → 调 LLM → 模型返回 toolCall: write_file(hello.ts)
  → 执行 write_file → 成功
  → messages 多了: assistant(toolCall) + toolResult(成功)

循环 #2:
  messages: [user + assistant(write) + toolResult(ok)]
  → 调 LLM → 模型返回 toolCall: bash("npx tsx hello.ts")
  → 执行 bash → 输出 "Hello, World!"
  → messages 多了: assistant(toolCall) + toolResult(Hello, World!)

循环 #3:
  messages: [user + write + result + bash + result]
  → 调 LLM → 模型返回 text("已经创建并运行了 hello.ts...")
  → 没有 toolCall → break，循环结束
```

3 次 LLM 调用、2 次工具执行、1 次最终回答。Agent 自主完成了"创建文件 + 运行"的任务。

---

## 小结

Agent Loop 是一个 while 循环：调用 LLM → 有 toolCall 就执行工具、把结果追加到 messages → 再次调用 LLM → 直到没有 toolCall（任务完成）或 stopReason 是 error（调用失败）。两个设计原则保证循环的健壮性：LLM 调用永不 throw（错误编码在 stopReason），工具执行永不 throw（错误转为 ToolResult 让 LLM 自行处理）。这 120 行代码就是 Claude Code、Cursor 等工具的核心引擎。

---

## 下一章

Agent Loop 有了，但工具只有一个演示用的 get_current_time。Coding Agent 需要哪些真正有用的工具？读文件、写文件、编辑文件、执行命令——下一章来实现这四个核心工具。

→ [第 08 章：核心工具 — read / write / edit / bash](./08-core-tools.md)
