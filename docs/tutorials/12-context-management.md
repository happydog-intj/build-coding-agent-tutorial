# 第 12 章：上下文窗口管理 — 历史不动，上下文按预算重建

> 对话越来越长，超出模型的上下文窗口怎么办？

## 这一章要解决什么问题？

模型的上下文窗口有大小限制。Claude Sonnet 是 200K token，GPT-4o 是 128K token。听起来很多，但一个复杂的编程任务 — 读了十几个文件、执行了几十次工具 — 消息累积起来很快接近上限。

超出窗口后 API 会直接拒绝请求。我们需要一种机制：在不丢失完整会话历史的前提下，构建一个"装得下"的 Context 传给模型。

核心区分：**Session**（完整历史，永久存储）和 **Context**（每次调用临时构建，可截断）。截断只发生在 Context 构建层，Session 永远不动。

---

## Session vs Context

| | Session | Context |
|---|---------|---------|
| 内容 | 完整的对话历史（所有消息） | 每次 LLM 调用的输入 |
| 存储 | JSONL 文件，永久保留 | 内存中临时构建 |
| 修改 | 只追加，不删除 | 每次调用时按预算裁剪 |
| 用途 | 记录、回溯、分支 | 传给模型看 |

同一个 Session 可以构建出不同的 Context — 根据当前的窗口预算决定保留多少消息。

---

## 不可拆分的交互

截断不能在任意位置切。看这个消息序列：

```
messages[3]: assistant([toolCall: read_file("app.ts")])
messages[4]: toolResult(toolCallId: "tc1", content: "file content...")
```

如果截断时保留了 messages[3] 但丢弃了 messages[4]，模型看到"我请求了 read_file 但没有收到结果"— 这违反了 toolCallId 配对的不变量。

规则：**toolCall 和对应的 toolResult 必须成对保留或成对丢弃。**

一组"不可拆分的交互"是：
- 一条 user 消息
- 一条 assistant 消息 + 它触发的所有 toolResult

截断的最小单位是这样的一组交互，不是单条消息。

---

## 交互分组

把 messages 按交互分组：

```typescript
interface Interaction {
  messages: Message[];  // 一组不可拆分的消息
  tokenCount: number;   // 这组消息的总 token 数
}

function groupIntoInteractions(messages: Message[]): Interaction[] {
  const groups: Interaction[] = [];
  let current: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "user" && current.length > 0) {
      // 新的 user 消息开始新的交互组
      groups.push({ messages: current, tokenCount: estimateTokens(current) });
      current = [];
    }
    current.push(msg);
  }

  if (current.length > 0) {
    groups.push({ messages: current, tokenCount: estimateTokens(current) });
  }

  return groups;
}
```

每组交互从 user 消息开始，包含后续的 assistant + toolResult（直到下一条 user 消息出现）。

---

## 按预算构建 Context

从后往前扫描交互组，在预算内保留尽可能多的最近交互：

```typescript
function buildContext(session: Message[], budget: number, systemPrompt: string): Context {
  // 1. 始终保留 system prompt
  let used = estimateTokens(systemPrompt);

  // 2. 交互分组
  const interactions = groupIntoInteractions(session);

  // 3. 从后向前，保留预算内的交互
  const kept: Message[] = [];
  for (let i = interactions.length - 1; i >= 0; i--) {
    const cost = interactions[i].tokenCount;
    if (used + cost > budget) break;  // 预算不够了
    kept.unshift(...interactions[i].messages);
    used += cost;
  }

  return { systemPrompt, messages: kept };
}
```

最近的交互对当前任务最相关，所以从后往前保留。被截断的是最早的交互 — 通常是已经完成的旧任务。

---

## 截断策略

完整的截断策略：

```
1. 计算 system prompt 的 token 数，从预算中扣除
2. 把 messages 分成交互组
3. 从后往前累加每组的 token 数
4. 当累加超过预算时停止
5. 被截断的交互从 Context 中移除
6.（可选）对被截断的部分生成摘要，注入 system prompt
```

第 6 步是增强功能：把被丢弃的历史压缩成一段摘要文本，加在 system prompt 的末尾。模型虽然看不到原始消息了，但能看到"之前你们讨论了 X 和 Y"这样的概括。

---

## 摘要生成（可选增强）

```typescript
function buildContextWithSummary(session: Message[], budget: number, systemPrompt: string): Context {
  const interactions = groupIntoInteractions(session);

  // 从后向前找到保留边界
  let used = estimateTokens(systemPrompt);
  let keepFrom = interactions.length;
  for (let i = interactions.length - 1; i >= 0; i--) {
    if (used + interactions[i].tokenCount > budget * 0.8) break;  // 留 20% 给摘要
    keepFrom = i;
    used += interactions[i].tokenCount;
  }

  const truncated = interactions.slice(0, keepFrom);
  const kept = interactions.slice(keepFrom);

  // 生成摘要（可以用模型生成，也可以用简单规则）
  let enhancedPrompt = systemPrompt;
  if (truncated.length > 0) {
    const summary = generateSummary(truncated);  // 提取关键信息
    enhancedPrompt += `\n\n[Earlier context summary: ${summary}]`;
  }

  return { systemPrompt: enhancedPrompt, messages: kept.flatMap(i => i.messages) };
}
```

摘要是按需生成的 — 只有当对话真的太长需要截断时才生成。短对话不会触发这个机制。

---

## Token 估算

精确计算 token 数需要调用 tokenizer，但对于预算管理来说粗略估算就够了：

```typescript
function estimateTokens(input: string | Message[]): number {
  const text = typeof input === "string"
    ? input
    : JSON.stringify(input);

  // 粗略估算：英文约 4 字符/token，中文约 2 字符/token
  // 用 3 作为平均值，略微高估（宁可留余量）
  return Math.ceil(text.length / 3);
}
```

高估比低估好 — 高估最多是少保留一两组交互，低估可能导致 API 请求被拒绝。

---

## 在 Agent Loop 中集成

```typescript
while (true) {
  // 不再直接用完整 messages，而是按预算构建 Context
  const context = buildContext(
    messages,
    config.model.contextWindow * 0.9,  // 留 10% 余量给模型输出
    config.systemPrompt
  );

  const stream = config.streamFn(config.model, context);
  // ...
}
```

Pi 完整版中这一步通过 `transformContext` 回调实现 — Agent Loop 在每轮调用前调用它，让外部逻辑决定怎么构建 Context。

---

## 关键决策总结

| 决策 | 选择 | 原因 |
|------|------|------|
| 截断单位 | 完整交互（不是单条消息） | toolCall/toolResult 不可拆分 |
| 截断方向 | 丢弃最旧的 | 最近的上下文对当前任务最相关 |
| 摘要时机 | 截断时按需生成 | 不提前浪费 token |
| Session 修改 | 不修改 | 从任意叶子重建不同的 Context |
| 预算分配 | 90% 给输入 | 留余量给模型输出 |

---

## 小结

上下文窗口管理的核心是区分 Session（完整历史，不动）和 Context（每次调用临时构建，可截断）。截断以"不可拆分的交互"为最小单位 — toolCall 和 toolResult 必须成对保留或丢弃。从后向前按预算保留最近的交互，被截断的旧历史可以压缩成摘要注入 system prompt。整个过程不修改 Session，保证从任意时刻都能重建不同的 Context。

---

## 下一章

Agent 的核心功能完成了。但产品化还缺一件事 — 怎样在不修改 Agent Loop 代码的前提下添加新能力？比如权限控制（危险命令要确认）、知识注入（给模型额外指令）？下一章看扩展系统的设计。

→ [第 13 章：扩展系统 — 不污染核心的产品化](./13-extension-system.md)
