---
title: "会话持久化 — JSONL 崩溃安全存储"
description: "用 JSONL 格式逐条追加保存对话消息，实现崩溃安全的会话持久化与恢复"
---

# 第 09 章：会话持久化 — JSONL 崩溃安全存储

> 关掉终端对话就丢了，怎样保存和恢复？

## 这一章要解决什么问题？

到目前为止，所有对话数据都存在内存的 messages 数组里。终端一关、进程一挂，全部丢失。用户花了十分钟让 Agent 写的代码虽然落盘了，但对话历史没了 — 下次打开不知道之前聊过什么。

这一章用 JSONL（JSON Lines）格式实现持久化：每条消息即时追加到文件，进程崩溃最多丢失最后一条未写完的消息。

---

## 为什么选 JSONL 而不是 JSON？

对比两种方案：

**方案 A：整个 JSON 文件**
```json
[
  {"role":"user","content":"hello"},
  {"role":"assistant","content":[...]}
]
```

每次有新消息，要把整个数组读出来、加一条、重新写回去。如果写到一半程序崩了 — 文件内容损坏，之前所有消息全丢。

**方案 B：JSONL（每行一条消息）**
```
{"role":"user","content":"hello","timestamp":1718400000}
{"role":"assistant","content":[...],"timestamp":1718400005}
```

每次有新消息，直接追加一行到文件末尾。如果写到一半崩了 — 只有最后一行是不完整的，前面所有行都完好无损。恢复时逐行解析，跳过损坏行就行。

JSONL 的代价是文件格式不太方便人类阅读（不像缩进的 JSON 那么漂亮），但对于机器读写和崩溃安全来说，这是最简单的方案。

---

## 完整实现：session.ts

```typescript
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";

const SESSIONS_DIR = ".mini-pi-coding-agent-sessions";

/**
 * 获取会话文件路径
 */
export function getSessionPath(sessionId?: string): string {
  const id = sessionId ?? generateSessionId();
  const dir = join(process.cwd(), SESSIONS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, `${id}.jsonl`);
}

/**
 * 追加一条消息到会话文件
 */
export function appendMessage(sessionFile: string, message: Message): void {
  const dir = dirname(sessionFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(sessionFile, JSON.stringify(message) + "\n");
}

/**
 * 加载已有会话
 */
export function loadSession(sessionFile: string): Message[] {
  if (!existsSync(sessionFile)) return [];

  const content = readFileSync(sessionFile, "utf-8");
  const messages: Message[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      // 跳过损坏的行（崩溃安全：部分写入的行被忽略）
    }
  }

  return messages;
}

function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${date}_${time}_${rand}`;
}
```

---

## 逐段解释

### appendMessage — 崩溃安全的写入

```typescript
appendFileSync(sessionFile, JSON.stringify(message) + "\n");
```

用 `appendFileSync`（同步追加）而不是异步的 `appendFile`。为什么？

同步写保证：当这行代码返回时，数据已经到达文件系统缓冲区。如果用异步写，`appendFile` 返回时数据可能还在 Node.js 的 buffer 里，此时进程崩溃数据就丢了。

每条消息序列化为一行 JSON 后追加。`\n` 换行符作为消息边界。

### loadSession — 容忍损坏行

```typescript
for (const line of content.split("\n")) {
  if (!line.trim()) continue;
  try {
    messages.push(JSON.parse(line));
  } catch {
    // 跳过损坏行
  }
}
```

逐行解析，每行是一个独立的 JSON 对象。如果某一行 `JSON.parse` 失败（写到一半崩了的那行），直接跳过，继续解析后面的行。

这就是崩溃安全的含义：文件中已经完整写入的行不受影响，只有最后一行可能是不完整的。

### generateSessionId — 人类可读的 ID

```typescript
// 生成格式：2024-06-15_143022_a7x2
const id = `${date}_${time}_${rand}`;
```

用日期 + 时间 + 随机后缀组成 ID。这样看文件名就知道是什么时候的会话，不需要打开文件才知道。

---

## 在 index.ts 中使用持久化

看一下 CLI 入口怎么集成会话持久化：

```typescript
// 启动时：加载或创建会话
const sessionFile = getSessionPath(resumeArg);
let messages: Message[] = resumeArg ? loadSession(sessionFile) : [];

// 每次 Agent 运行后：保存新增的消息
const prevLength = messages.length;
await runAgent(trimmed, messages, config);

// 只保存新增的消息（不重写整个文件）
for (let i = prevLength; i < messages.length; i++) {
  appendMessage(sessionFile, messages[i]);
}
```

关键点：`runAgent` 执行过程中 messages 数组会被原地修改（追加 assistant 消息和 toolResult 消息）。运行结束后，对比前后长度差，只把新增的消息追加到文件。

---

## 恢复会话

```bash
# 首次运行 — 自动创建新会话文件
npx tsx src/index.ts

# 恢复之前的会话
npx tsx src/index.ts --resume=2024-06-15_143022_a7x2
```

恢复时 `loadSession` 逐行解析 JSONL 文件重建 messages 数组。Agent 能看到之前所有的对话历史，就像从没关过一样。

---

## 不变量：Session 只追加，不修改历史

整个持久化设计遵循一条规则：**文件只追加，不回写已有内容。**

- 新消息 → appendFileSync 追加
- 恢复 → readFileSync 读取
- 没有任何代码会修改或删除文件中已有的行

这个约束带来两个好处：
1. 实现简单 — 不需要锁、不需要事务
2. 崩溃安全 — append 操作是原子的（对于单行 JSON 来说）

---

## 小结

JSONL 持久化用最简单的方式解决了会话保存问题：每条消息即时追加一行 JSON 到文件，恢复时逐行解析跳过损坏行。`appendFileSync` 保证同步写入，崩溃最多丢失最后一条不完整的消息。Session 只追加不修改，实现简单且安全。

---

## 下一章

会话能保存了，但 Agent 运行中如果用户按了 Ctrl+C 怎么办？流式调用还在进行中，工具可能正在执行，怎样干净地取消？下一章把纯函数的 `runAgent` 演化成有状态的 Agent 对象，支持 abort、steering 和重入保护。

→ [第 10 章：有状态 Agent — abort、steering 与重入](./10-stateful-agent.md)
