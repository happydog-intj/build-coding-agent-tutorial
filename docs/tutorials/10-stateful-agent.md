# 第 10 章：有状态 Agent — abort、steering 与重入

> 用户按了 Ctrl+C 怎么办？运行中如何注入新指令？

## 这一章要解决什么问题？

到目前为止 `runAgent` 是一个纯函数：调用一次，跑完返回。但实际使用中有几个问题纯函数解决不了：

1. **取消**：模型正在生成一个超长的回复，用户想中断，怎么办？
2. **重入**：Agent 正在运行时，用户又按了回车发了新消息，怎么办？
3. **Steering**：Agent 跑到一半，用户想补充一条"别用那个方案，换一个"，怎么注入？

这一章把 `runAgent` 函数演化为有状态的 `Agent` 类，支持 abort（取消）、steering（运行中注入消息）和重入保护。

---

## 从纯函数到有状态对象

之前的用法：

```typescript
// 纯函数 — 调用一次，跑完返回
await runAgent(prompt, messages, config);
```

演化后：

```typescript
// 有状态对象 — 持有运行状态
const agent = new Agent(config);
await agent.run(prompt);     // 运行
agent.abort();               // 取消
agent.steer("换个方案");      // 运行中注入
```

---

## AbortController 实现取消

JavaScript 标准的取消机制是 `AbortController` + `AbortSignal`。思路是：创建一个 controller，把它的 signal 传播到每一层需要取消的操作。

```typescript
class Agent {
  private running = false;
  private abortController: AbortController | null = null;
  private messages: Message[] = [];
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async run(prompt: string): Promise<void> {
    // 重入保护
    if (this.running) {
      throw new Error("Agent is already running");
    }

    this.running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      this.messages.push({ role: "user", content: prompt, timestamp: Date.now() });

      while (true) {
        // 每步循环开始前检查是否被取消
        if (signal.aborted) break;

        const context: Context = {
          systemPrompt: this.config.systemPrompt,
          messages: this.messages,
          tools: this.toolSchemas,
        };

        const stream = this.config.streamFn(this.config.model, context, { signal });
        const assistantMsg = await consumeStream(stream, this.config);
        this.messages.push(assistantMsg);

        if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") break;

        const toolCalls = assistantMsg.content.filter(c => c.type === "toolCall");
        if (toolCalls.length === 0) break;

        for (const tc of toolCalls) {
          if (signal.aborted) break;  // 工具执行前再检查一次
          const result = await this.executeTool(tc, signal);
          this.messages.push(result);
        }
      }
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}
```

signal 传播到三个地方：
1. **循环入口** — 每轮开始前检查
2. **流式调用** — `streamFn` 接收 signal，API 请求中断
3. **工具执行前** — 避免启动新的工具操作

---

## Ctrl+C 集成

在 CLI 中，用户按 Ctrl+C 发送 SIGINT 信号。把它接到 Agent 的 abort 方法上：

```typescript
const agent = new Agent(config);

process.on("SIGINT", () => {
  if (agent.isRunning) {
    agent.abort();
    console.log("\n\x1b[33m⚠ Aborted\x1b[0m\n");
  } else {
    // Agent 没在运行，正常退出程序
    process.exit(0);
  }
});
```

用户按 Ctrl+C 后：
- 如果 Agent 正在运行 → 取消当前任务，回到输入提示
- 如果在等待输入 → 退出程序

---

## Steering：运行中注入消息

有时候 Agent 跑到一半，你看到它走了一个错误的方向。你想说"停，别走这条路，试试另一种方案"。但 Agent 正在循环中，你没法输入。

Steering 的机制：把新消息加入一个队列，Agent Loop 在下一次调用模型之前检查队列，有新消息就注入到 messages 中。

```typescript
class Agent {
  private steeringQueue: string[] = [];

  steer(message: string): void {
    this.steeringQueue.push(message);
  }

  async run(prompt: string): Promise<void> {
    // ...
    while (true) {
      // 在调用模型之前，检查 steering 队列
      this.injectSteering();

      const stream = this.config.streamFn(this.config.model, context);
      // ...
    }
  }

  private injectSteering(): void {
    while (this.steeringQueue.length > 0) {
      const msg = this.steeringQueue.shift()!;
      this.messages.push({ role: "user", content: msg, timestamp: Date.now() });
    }
  }
}
```

Steering 消息以 `user` 角色插入。模型下一轮调用时就能看到这条新指令，调整后续行为。

---

## 重入保护

如果 Agent 正在运行时，代码又调了一次 `agent.run()`，会发生什么？两个循环并行修改同一个 messages 数组 — 消息顺序乱套，工具结果配对错误。

解法很简单：运行时加一个 flag，第二次调用直接拒绝。

```typescript
async run(prompt: string): Promise<void> {
  if (this.running) {
    throw new Error("Agent is already running. Use steer() to inject messages.");
  }
  this.running = true;
  try {
    // ... agent loop
  } finally {
    this.running = false;  // 不管正常结束还是异常，都重置
  }
}
```

`finally` 确保即使循环中间抛了异常，`running` 标志也会被重置。否则 Agent 会永远处于"正在运行"状态，无法再接受新任务。

---

## 事件订阅

有状态的 Agent 可以暴露事件，让外部观察运行过程：

```typescript
interface AgentEvents {
  onText?: (text: string) => void;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
  onAbort?: () => void;
  onError?: (error: string) => void;
}
```

之前这些回调在 AgentConfig 里。有状态对象的好处是可以动态添加或移除事件监听 — 比如 UI 组件挂载时订阅、卸载时取消。

---

## 完整的 Agent 类接口

把所有能力放在一起看：

```typescript
class Agent {
  // 状态查询
  get isRunning(): boolean;
  get messageCount(): number;

  // 核心操作
  run(prompt: string): Promise<void>;  // 运行（重入保护）
  abort(): void;                        // 取消当前运行
  steer(message: string): void;         // 运行中注入指令

  // 会话管理
  getMessages(): Message[];             // 获取完整历史
  clearMessages(): void;                // 清空历史
}
```

---

## 与 Pi 完整版对比

| 方面 | 本教程 | Pi 完整版 |
|------|--------|----------|
| 取消 | AbortController + signal 传播 | 同样，但 signal 还传递到子进程 |
| Steering | 简单队列 + 下一轮注入 | `getSteeringMessages` 回调，支持条件注入 |
| 重入 | throw Error | 同样，但有优雅的排队机制 |
| 事件 | 回调函数 | EventEmitter + 类型安全的事件系统 |

---

## 小结

有状态的 Agent 解决了三个纯函数无法处理的问题。AbortController 的 signal 传播到循环入口、流式调用和工具执行，实现干净取消。Steering 队列在每次模型调用前注入新消息，让用户能在运行中调整方向。重入保护通过一个 running 标志防止并行修改 messages 数组。三者加在一起，把 Agent 从"调用一次跑完"变成"可以交互控制的长时间运行对象"。

---

## 下一章

现在 messages 是一个线性数组 — 对话只有一条路。如果用户想"回到之前的某个点，重新对话一次"呢？下一章把线性 messages 演化为树形结构，支持分支和回溯。

→ [第 11 章：会话树 — 分支、回溯与 DAG](./11-session-tree.md)
