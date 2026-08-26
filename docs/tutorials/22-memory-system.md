---
title: "跨会话记忆 — 让 Agent 越用越聪明"
description: "从单次对话到持久知识：会话笔记提取、持久记忆文件、记忆注入与上下文压缩的协作"
---

# 第 22 章：跨会话记忆 — 让 Agent 越用越聪明

> 上下文压缩解决"放不下"的问题，但压缩就是遗忘。记忆系统解决的是：被压缩掉的信息去了哪里？下次会话怎么找回来？

## 这一章要解决什么问题？

第 12 章讲了上下文窗口管理——消息太多时截断或压缩。但这导致一个问题：

- Agent 昨天帮你定位了一个复杂的 bug，今天你问"昨天那个 bug 在哪？"它完全不知道
- 你反复告诉 Agent "这个项目用 pnpm 不是 npm"，每次新会话它又忘了
- 长对话中前面提到的关键决策，被压缩后丢失了

记忆系统的目标：**信息从对话流转到持久层，跨会话可检索。**

---

## 记忆的两层架构

```
┌─────────────────────────────────────────┐
│  会话记忆（Session Memory）              │
│  - 当前对话的结构化笔记                    │
│  - 随对话进行实时更新                      │
│  - 压缩时作为摘要注入                      │
│  - 会话结束后丢弃                         │
├─────────────────────────────────────────┤
│  持久记忆（Persistent Memory）            │
│  - 跨会话的知识文件                        │
│  - ~/.agent/memory/ 目录下的 .md 文件      │
│  - 每次会话启动时注入 system prompt        │
│  - 永久保存，除非手动删除                   │
└─────────────────────────────────────────┘
```

---

## 会话记忆：对话中的实时笔记

### 笔记模板

每次会话开始时初始化一个结构化的笔记文件：

```typescript
const SESSION_MEMORY_TEMPLATE = `# Session Notes

## Decisions Made
- (none yet)

## Key Files
- (none yet)

## Problems Encountered
- (none yet)

## User Preferences
- (none yet)
`;
```

### 后台提取

在 Agent Loop 每轮结束后，用一个轻量级的后台调用提取笔记：

```typescript
interface SessionMemory {
  content: string;           // 当前笔记内容
  lastUpdated: number;       // 最后更新时间
}

async function updateSessionMemory(
  messages: Message[],
  currentMemory: SessionMemory,
  streamFn: StreamFunction
): Promise<SessionMemory> {
  // 只在消息足够多时更新（避免频繁调用）
  if (messages.length < 6) return currentMemory;

  // 取最近的几轮对话作为输入
  const recentMessages = messages.slice(-10);

  const extractionPrompt = `Based on the recent conversation, update these session notes.
Only add genuinely important information. Keep it concise.

Current notes:
${currentMemory.content}

Rules:
- Add decisions that were made
- Add key files that were discussed or modified
- Add problems encountered and their solutions
- Add user preferences you observed
- Remove items that are no longer relevant
- Keep each section under 5 bullet points

Return ONLY the updated markdown notes, nothing else.`;

  const response = await streamFn("fast-model", [
    { role: "user", content: extractionPrompt },
    // 附上最近对话作为上下文
    ...recentMessages.map(m => ({
      role: m.role,
      content: typeof m.content === "string"
        ? m.content.slice(0, 500) // 截断长内容
        : "[tool interaction]",
    })),
  ]);

  return {
    content: response.text,
    lastUpdated: Date.now(),
  };
}
```

### 与压缩的协作

当上下文压缩触发时，会话记忆被注入为压缩后的摘要头部：

```typescript
function compactMessages(
  messages: Message[],
  sessionMemory: SessionMemory
): Message[] {
  // 保留最近的消息
  const recent = messages.slice(-6);

  // 会话记忆作为摘要注入
  const summary: Message = {
    role: "user",
    content: `[Previous conversation summary]\n${sessionMemory.content}\n\n[Conversation continues below]`,
  };

  return [summary, ...recent];
}
```

这样压缩不是简单的丢弃，而是**把重要信息转移到笔记中，再用笔记作为压缩后的锚点**。

---

## 持久记忆：跨会话的知识库

### 记忆文件格式

每条持久记忆是一个独立的 Markdown 文件：

```markdown
<!-- ~/.agent/memory/project-uses-pnpm.md -->
---
name: project-uses-pnpm
type: project
created: 2024-01-15T10:30:00Z
---

This project uses pnpm as the package manager, not npm.

**Why:** The monorepo structure requires pnpm workspaces.

**How to apply:** Always use `pnpm install`, `pnpm test`, `pnpm run build`.
Never suggest `npm install` or `yarn add`.
```

### 记忆提取

在会话结束时（或用户显式要求时），从对话中提取值得记住的信息：

```typescript
interface MemoryEntry {
  name: string;            // 短标识（kebab-case）
  type: "user" | "project" | "feedback";
  content: string;         // 记忆正文
}

async function extractMemories(
  messages: Message[],
  existingMemories: MemoryEntry[],
  streamFn: StreamFunction
): Promise<MemoryEntry[]> {
  const existingNames = existingMemories.map(m => m.name).join(", ");

  const prompt = `Review this conversation and extract information worth remembering
for future sessions. Only extract genuinely useful long-term knowledge.

Already known: ${existingNames}

Categories:
- "user": who the user is, their preferences, expertise
- "project": project constraints, conventions, architecture decisions
- "feedback": corrections the user made about how to work

For each memory, provide:
- name: short-kebab-case-id
- type: user | project | feedback
- content: the fact, with "Why:" and "How to apply:" lines

Return JSON array. Return [] if nothing worth remembering.`;

  const response = await streamFn("fast-model", [
    { role: "system", content: prompt },
    ...messages.slice(-20), // 最后 20 条消息
  ]);

  try {
    return JSON.parse(response.text);
  } catch {
    return [];
  }
}
```

### 记忆存储

```typescript
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import path from "path";

const MEMORY_DIR = path.join(process.env.HOME!, ".agent", "memory");

function saveMemory(entry: MemoryEntry): void {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });

  const filePath = path.join(MEMORY_DIR, `${entry.name}.md`);
  const content = `---
name: ${entry.name}
type: ${entry.type}
created: ${new Date().toISOString()}
---

${entry.content}
`;
  writeFileSync(filePath, content, "utf-8");
}

function loadMemories(): MemoryEntry[] {
  if (!existsSync(MEMORY_DIR)) return [];

  return readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const raw = readFileSync(path.join(MEMORY_DIR, f), "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;
      const frontmatter = match[1];
      const content = match[2].trim();
      const name = frontmatter.match(/name:\s*(.+)/)?.[1] ?? f.replace(".md", "");
      const type = (frontmatter.match(/type:\s*(.+)/)?.[1] ?? "project") as MemoryEntry["type"];
      return { name, type, content };
    })
    .filter(Boolean) as MemoryEntry[];
}
```

### 注入 System Prompt

每次会话启动时，把持久记忆加载到 system prompt 中：

```typescript
function buildSystemPrompt(basePrompt: string): string {
  const memories = loadMemories();

  if (memories.length === 0) return basePrompt;

  const memorySection = memories
    .map(m => `- [${m.type}] ${m.name}: ${m.content.split("\n")[0]}`)
    .join("\n");

  return `${basePrompt}

## Known context from previous sessions:
${memorySection}

Use this context naturally. Don't mention that you "remember" things — just apply the knowledge.`;
}
```

---

## 记忆的生命周期管理

记忆不能无限增长，需要管理：

```typescript
const MAX_MEMORIES = 50;
const MAX_MEMORY_TOKENS = 4000; // 注入 system prompt 的上限

function pruneMemories(memories: MemoryEntry[]): MemoryEntry[] {
  if (memories.length <= MAX_MEMORIES) return memories;

  // 按类型优先级排序：feedback > project > user
  const priority: Record<string, number> = { feedback: 3, project: 2, user: 1 };
  return memories
    .sort((a, b) => (priority[b.type] ?? 0) - (priority[a.type] ?? 0))
    .slice(0, MAX_MEMORIES);
}

function fitMemoriesInBudget(memories: MemoryEntry[], maxTokens: number): MemoryEntry[] {
  let totalTokens = 0;
  const result: MemoryEntry[] = [];

  for (const m of memories) {
    const tokens = estimateTokens(m.content);
    if (totalTokens + tokens > maxTokens) break;
    totalTokens += tokens;
    result.push(m);
  }

  return result;
}
```

---

## 完整集成

```typescript
// Agent 启动时
const memories = loadMemories();
const systemPrompt = buildSystemPrompt(BASE_SYSTEM_PROMPT);
let sessionMemory: SessionMemory = { content: SESSION_MEMORY_TEMPLATE, lastUpdated: 0 };

// Agent Loop 中
while (true) {
  const response = await streamFn(model, messages);
  // ... 正常处理 ...

  // 每 N 轮更新会话记忆（后台，不阻塞主流程）
  if (messages.length % 4 === 0) {
    sessionMemory = await updateSessionMemory(messages, sessionMemory, streamFn);
  }
}

// 会话结束时
const newMemories = await extractMemories(messages, memories, streamFn);
for (const m of newMemories) {
  saveMemory(m);
}
```

---

## 小结

记忆系统分两层：会话记忆在对话过程中实时提取笔记，压缩时作为摘要注入，确保"压缩不等于遗忘"。持久记忆在会话结束时从对话中提取值得长期保存的信息，写入文件系统，下次会话启动时注入 system prompt。两层协作让 Agent 既能处理长对话中的信息流转，又能跨会话积累知识。核心洞察：**压缩是转移，不是丢弃**——信息从对话历史流向记忆层，再从记忆层流回新的对话。
