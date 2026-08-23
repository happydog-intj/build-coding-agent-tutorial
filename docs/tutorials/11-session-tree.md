# 第 11 章：会话树 — 分支、回溯与 DAG

> 线性对话只有一条路。如果想回到之前一个问题，继续问呢？

## 这一章要解决什么问题？

线性 messages 数组有一个限制：对话只有一条路径。用户说了 A，模型回了 B，用户接着说了 C。如果用户觉得 C 问得不好，想回到 B 之后换一种问法 — 线性结构做不到。

这一章把 messages 从线性数组演化为树形 DAG（有向无环图）。每条消息有 `id` 和 `parentId`，可以从历史中任意一个节点分支出去。传给模型的 messages 是从根到当前叶子的路径，而所有分支都保留在存储中。

---

## 从线性到树形

线性结构：

```
A → B → C → D → E（当前）
```

只有一条路径，没有回溯余地。

树形结构：

```
A → B → C → D → E（分支 1）
         ↘
          C' → D'（分支 2：从 B 分出去的新对话）
```

从 B 节点"分叉"，创建了一条新的对话路径。两条路径共享 A → B 的前缀，之后各走各的。

---

## 数据模型

每条消息多两个字段：`id`（自己是谁）和 `parentId`（父节点是谁）。

```typescript
interface StoredMessage {
  id: string;              // 唯一标识（nanoid 或 UUID）
  parentId: string | null; // 父消息 ID，根节点为 null
  message: Message;        // 实际的消息内容
}
```

所有消息平铺存储在 JSONL 文件中（只追加，和第 09 章一样）。树的结构通过 id/parentId 关系重建。

---

## Active Path：传给模型的消息序列

模型每次调用只看一条线性路径 — 从根节点到当前叶子节点的路径。这条路径叫 active path。

```typescript
function getActivePath(leafId: string, store: StoredMessage[]): Message[] {
  const path: Message[] = [];
  let currentId: string | null = leafId;

  while (currentId !== null) {
    const node = store.find(n => n.id === currentId);
    if (!node) break;
    path.unshift(node.message);  // 加到开头（从叶子往根回溯）
    currentId = node.parentId;
  }

  return path;
}
```

从叶子开始，沿 parentId 往上走，直到根节点（parentId 为 null）。收集路上经过的所有消息，就是传给模型的 messages。

---

## 分支操作：fork

从历史中的某个节点创建新分支：

```typescript
function fork(fromNodeId: string, newMessage: Message, store: StoredMessage[]): StoredMessage {
  const newNode: StoredMessage = {
    id: generateId(),
    parentId: fromNodeId,   // 新消息的父节点是分支起点
    message: newMessage,
  };
  store.push(newNode);
  return newNode;
}
```

fork 做的事情很简单：创建一个新节点，它的 parentId 指向你想回溯到的那个节点。新节点成为新分支的第一条消息。

---

## 用例：用户重新提问

场景：对话进行了三轮（A → B → C → D → E），用户觉得 C 这条消息问得不好，想从 B 之后重新问。

```typescript
// 当前 store 中的消息
// A(root) → B → C → D → E

// 用户选择从 B 节点分支
const newBranch = fork("B", { role: "user", content: "换一种问法...", timestamp: Date.now() }, store);

// 现在 store 中有：
// A → B → C → D → E   （原分支）
//      ↘ newBranch     （新分支）

// 切换 active path 到新分支
const activePath = getActivePath(newBranch.id, store);
// activePath = [A.message, B.message, newBranch.message]
```

模型看到的 messages 变成了 [A, B, 新问题] — 它不知道还存在原来的 C → D → E 分支。

---

## JSONL 存储格式

树形消息在 JSONL 中仍然是逐行追加，每行多了 id 和 parentId：

```
{"id":"msg_001","parentId":null,"message":{"role":"user","content":"hello","timestamp":1718400000}}
{"id":"msg_002","parentId":"msg_001","message":{"role":"assistant","content":[...],"timestamp":1718400005}}
{"id":"msg_003","parentId":"msg_002","message":{"role":"user","content":"继续","timestamp":1718400010}}
{"id":"msg_004","parentId":"msg_002","message":{"role":"user","content":"换一种问法","timestamp":1718400020}}
```

msg_003 和 msg_004 的 parentId 都是 msg_002 — 从同一个节点分出了两条路径。恢复时读取全部行，在内存中重建树结构。

---

## 不变量

1. **只追加不修改** — 分支不删除旧消息，JSONL 文件只有 append 操作
2. **parentId 不可变** — 节点一旦写入，它的父节点关系永远不变
3. **Context 从任意叶子重建** — 给一个叶子 ID，就能通过 getActivePath 重建完整的 messages

这三条保证了：不管有多少分支，任何一条路径都能独立重建，互不干扰。

---

## 与线性 Session 的关系

线性 Session（第 09 章）是树形 Session 的特例：所有节点的 parentId 都指向前一个节点，没有分支。

```
线性：  A(null) → B(A) → C(B) → D(C)
树形：  A(null) → B(A) → C(B) → D(C)
                       ↘ C'(B) → D'(C')
```

如果你的应用不需要分支功能，用线性 Session 就够了（实现更简单）。但理解树形结构能帮你理解 Claude Code 和 Cursor 怎么实现"编辑历史消息后重新对话"的功能。

---

## 实现对话编辑

"编辑之前的消息"本质上就是 fork：

```typescript
function editMessage(nodeId: string, newContent: string, store: StoredMessage[]): StoredMessage {
  // 找到要编辑的节点
  const node = store.find(n => n.id === nodeId);
  if (!node) throw new Error("Node not found");

  // 创建一个新节点，挂在同一个父节点下
  // （不修改原节点 — 只追加的原则）
  const editedNode: StoredMessage = {
    id: generateId(),
    parentId: node.parentId,   // 和原节点共享同一个父节点
    message: { ...node.message, content: newContent, timestamp: Date.now() },
  };
  store.push(editedNode);
  return editedNode;
}
```

编辑 = 在同一个 parentId 下创建新节点。原节点保留（历史不丢），新节点成为新的 active leaf。

---

## 真实场景：fork 是怎么发生的

上面讲了数据结构，但在真实产品里，fork 不是用户喊一声"请 fork"触发的。来看几个实际场景。

### 场景 1：用户编辑历史消息

最常见的 fork 触发方式。用户觉得之前某条消息问得不好，想改。

在 Claude.ai / ChatGPT 的 Web UI 中：用户点历史消息旁边的"编辑"按钮，修改内容，点"重新发送"。

在 CLI Agent 中，可以这样实现：

```typescript
// 用户输入 /edit 命令
// 例如：/edit 3 换一种问法...

function handleEdit(editIndex: number, newContent: string, store: StoredMessage[], currentLeafId: string) {
  // 1. 拿到当前 active path
  const path = getActivePath(currentLeafId, store);

  // 2. 找到要编辑的消息在 store 中的节点
  //    editIndex 是用户视角的序号（只数 user 消息）
  const userMessages = path.filter((_, i) => {
    const node = store.find(n => n.message === path[i]);
    return node?.message.role === "user";
  });
  const targetNode = store.find(n => n.message === userMessages[editIndex]);
  if (!targetNode) throw new Error("Message not found");

  // 3. fork：在同一个 parentId 下创建新节点
  const forkedNode: StoredMessage = {
    id: generateId(),
    parentId: targetNode.parentId,  // 关键：挂在同一个父节点下
    message: { role: "user", content: newContent, timestamp: Date.now() },
  };
  store.push(forkedNode);

  // 4. 切换 active leaf 到新节点
  return forkedNode.id;  // 新的 leafId，后续 agent loop 从这里继续
}
```

**交互效果**：用户编辑了第 3 条消息 → 系统 fork → 从新节点重新调用模型 → 模型基于修改后的上下文生成新回复。旧分支静默保留，不删除。

### 场景 2：工具执行失败，用户想回退重跑

这是 Agent 场景特有的问题。考虑这个对话历史：

```
user: "帮我重构这个文件"
  assistant: [tool_use: edit_file(...)]    ← 模型决定编辑文件
    user(tool_result): "文件已修改"        ← 工具执行结果
      assistant: "重构完成，我修改了..."     ← 模型总结
```

用户看了结果不满意，想回到 "帮我重构这个文件" 之后让模型重新决策。

**关键问题**：不能 fork 到 assistant 消息上（因为下一条必须是 user 角色）。也不能 fork 到 tool_result 上（那样模型还是会看到那次工具调用的上下文）。正确的 fork 点是**最后一条真正的 user 消息**。

```typescript
function forkBeforeToolUse(store: StoredMessage[], currentLeafId: string): string {
  const path = getActivePathNodes(currentLeafId, store);

  // 从当前叶子往回找，找到最近一条「真正的 user 消息」（不是 tool_result）
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (node.message.role === "user" && !isToolResult(node.message)) {
      // 找到了。fork 点是这条消息的父节点
      // 创建一个新的 user 消息（内容可以一样，也可以加补充指令）
      const forked: StoredMessage = {
        id: generateId(),
        parentId: node.parentId,
        message: {
          role: "user",
          content: node.message.content + "\n\n（补充：上次的方案不好，试试别的思路）",
          timestamp: Date.now(),
        },
      };
      store.push(forked);
      return forked.id;
    }
  }
  throw new Error("No user message found to fork from");
}
```

这里的关键认知：**tool_result 消息虽然 role 是 user，但它不是用户写的，它是工具系统自动填的**。fork 时必须区分"真正的用户输入"和"tool_result"。

### 场景 3：模型生成了多个候选回复

有些产品（如 Claude.ai 的 "retry"）让用户对同一条输入重新生成回复。这也是 fork — 只不过 fork 的是 assistant 节点：

```
user: "解释量子计算"
  ├─ assistant(v1): "量子计算是..."     ← 第一次生成
  └─ assistant(v2): "从经典计算说起..." ← retry 生成（同一个 parentId）
```

```typescript
function retry(userNodeId: string, store: StoredMessage[]): string {
  // 不创建新的 user 节点，直接在同一个 user 节点下发起新的模型调用
  // 模型的回复会自动挂在 userNodeId 下，形成兄弟 assistant 节点
  return userNodeId;  // active leaf 回退到 user 节点，重新跑 agent loop
}
```

### 分支管理：切换与展示

fork 多了之后，用户需要能切换分支。实现方式是维护一个 `currentLeafId`：

```typescript
class SessionTree {
  private store: StoredMessage[] = [];
  private currentLeafId: string | null = null;

  // 列出某个节点的所有子分支
  getBranches(nodeId: string): StoredMessage[] {
    return this.store.filter(n => n.parentId === nodeId);
  }

  // 切换到另一个分支的叶子
  switchBranch(leafId: string): void {
    this.currentLeafId = leafId;
    // active path 自动变化 — getActivePath(leafId) 会返回新路径
  }

  // 找到某个分支的最深叶子（用于切换后继续对话）
  findDeepestLeaf(nodeId: string): string {
    const children = this.store.filter(n => n.parentId === nodeId);
    if (children.length === 0) return nodeId;  // 自己就是叶子
    // 取最后一个子节点（最新的分支），递归找它的最深叶子
    return this.findDeepestLeaf(children[children.length - 1].id);
  }
}
```

在 CLI 中可以暴露这些命令：

```
/branches       — 列出当前节点的所有分支
/switch 2       — 切换到第 2 个分支
/edit 3 新内容  — 编辑第 3 条消息（自动 fork）
/retry          — 重新生成当前回复
```

### Claude Code 的实际做法

Claude Code 的实现（简化）：

1. **编辑即 fork** — 用户编辑任何历史消息时，自动在那条消息的 parentId 下创建新节点，切换 active leaf
2. **旧分支静默保留** — 不删除、不提示，JSONL 里一直在。用户可以通过 UI 切回去
3. **Context 重建基于 leafId** — 每次调用模型前，从 currentLeafId 回溯 getActivePath，拿到干净的线性 messages
4. **Compact（上下文压缩）也是 fork** — 当上下文太长需要压缩时，压缩后的 summary 作为新的根节点，本质上也是在树上开辟新路径

第 4 点是个有趣的设计：context compaction 不是修改已有消息，而是创建一条 summary 消息作为新分支的起点。这样如果用户想回到压缩前的完整历史，只要切换回旧分支的叶子就行。

---

## 小结

会话树把线性 messages 演化为 DAG：每条消息有 id 和 parentId，支持从任意节点分支。Active path 是从根到当前叶子的路径（传给模型的 messages），所有分支在 JSONL 中平铺存储，只追加不修改。分支操作（fork）和编辑操作本质相同 — 在同一个 parentId 下创建新节点。不管树有多复杂，给定一个叶子 ID 就能通过 parentId 链重建完整的线性 messages。

真实场景中，fork 由用户编辑历史消息、retry、工具执行回退等操作触发。关键的实现细节是：fork 点必须选对（不能 fork 到 tool_result 上），tool_result 和真正的 user 消息要区分，分支切换只需要改 currentLeafId。

---

## 下一章

会话越来越长，但模型的上下文窗口是有限的。100 轮对话后 messages 可能有几万个 token，超过窗口大小。下一章来看怎样在不丢失会话历史的前提下，按预算构建传给模型的 Context。

→ [第 12 章：上下文窗口管理 — 历史不动，上下文按预算重建](./12-context-management.md)
