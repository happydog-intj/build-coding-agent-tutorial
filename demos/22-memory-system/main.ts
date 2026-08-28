/**
 * 第 22 章：跨会话记忆 — 让 Agent 越用越聪明
 *
 * 用 ScriptedModel 模拟三种记忆机制：
 * 1. 会话记忆：实时从对话中提取关键信息为结构化笔记
 * 2. 持久记忆：写入/读取 markdown 文件，跨会话保持
 * 3. 上下文压缩：记忆作为压缩后的锚点，确保关键信息不丢失
 *
 * 无需 API key！
 *
 * 运行方式：
 *   npx tsx main.ts
 */

import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AssistantMessage, AssistantMessageEventStream, Context } from "@earendil-works/pi-ai";

// ─── ScriptedModel ──────────────────────────────────────────────────────────
function createScriptedModel(responses: AssistantMessage[]) {
  let cursor = 0;
  return {
    get callCount() { return cursor; },
    next(_ctx: Context): AssistantMessageEventStream {
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

// ─── Session Memory: Structured Notes ───────────────────────────────────────

interface SessionMemory {
  decisions: string[];
  keyFiles: string[];
  problems: string[];
  preferences: string[];
}

function createSessionMemory(): SessionMemory {
  return { decisions: [], keyFiles: [], problems: [], preferences: [] };
}

function extractMemoryFromText(text: string, memory: SessionMemory): string[] {
  const extracted: string[] = [];

  // Detect package manager preferences
  const pmMatch = text.match(/using (pnpm|yarn|npm|bun)/i);
  if (pmMatch && !memory.preferences.includes(`Package manager: ${pmMatch[1]}`)) {
    memory.preferences.push(`Package manager: ${pmMatch[1]}`);
    extracted.push(`[偏好] Package manager: ${pmMatch[1]}`);
  }

  // Detect file references
  const fileMatch = text.match(/(?:working on|editing|modified|created)\s+["`']?([a-zA-Z0-9/_.-]+\.[a-z]+)["`']?/i);
  if (fileMatch && !memory.keyFiles.includes(fileMatch[1])) {
    memory.keyFiles.push(fileMatch[1]);
    extracted.push(`[关键文件] ${fileMatch[1]}`);
  }

  // Detect decisions
  const decisionMatch = text.match(/(?:decided to|let's use|going with|chose)\s+(.+?)(?:\.|$)/i);
  if (decisionMatch && !memory.decisions.includes(decisionMatch[1])) {
    memory.decisions.push(decisionMatch[1]);
    extracted.push(`[决策] ${decisionMatch[1]}`);
  }

  // Detect problems
  const problemMatch = text.match(/(?:error|bug|issue|problem):\s*(.+?)(?:\.|$)/i);
  if (problemMatch && !memory.problems.includes(problemMatch[1])) {
    memory.problems.push(problemMatch[1]);
    extracted.push(`[问题] ${problemMatch[1]}`);
  }

  return extracted;
}

function formatSessionMemory(memory: SessionMemory): string {
  const lines: string[] = ["## Session Notes"];
  if (memory.decisions.length) lines.push("### Decisions Made", ...memory.decisions.map(d => `- ${d}`));
  if (memory.keyFiles.length) lines.push("### Key Files", ...memory.keyFiles.map(f => `- ${f}`));
  if (memory.problems.length) lines.push("### Problems", ...memory.problems.map(p => `- ${p}`));
  if (memory.preferences.length) lines.push("### Preferences", ...memory.preferences.map(p => `- ${p}`));
  return lines.join("\n");
}

// ─── Persistent Memory: Markdown Files ──────────────────────────────────────

interface MemoryFile {
  name: string;
  type: "user" | "project" | "feedback";
  created: string;
  content: string;
}

function writeMemory(dir: string, mem: MemoryFile): string {
  const filePath = join(dir, `${mem.name}.md`);
  const frontmatter = [
    "---",
    `name: ${mem.name}`,
    `type: ${mem.type}`,
    `created: ${mem.created}`,
    "---",
    "",
    mem.content,
  ].join("\n");
  writeFileSync(filePath, frontmatter);
  return filePath;
}

function readMemory(filePath: string): MemoryFile | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;
  const attrs: Record<string, string> = {};
  fmMatch[1].split("\n").forEach(line => {
    const [k, ...v] = line.split(": ");
    if (k) attrs[k.trim()] = v.join(": ").trim();
  });
  return { name: attrs.name ?? "", type: (attrs.type as any) ?? "project", created: attrs.created ?? "", content: fmMatch[2].trim() };
}

function loadAllMemories(dir: string): MemoryFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".md")).map(f => readMemory(join(dir, f))).filter(Boolean) as MemoryFile[];
}

// ─── Memory Injection: Build System Prompt ──────────────────────────────────

function buildSystemPromptWithMemory(basePrompt: string, memories: MemoryFile[]): string {
  if (memories.length === 0) return basePrompt;
  const memSection = memories.map(m => `[${m.type}] ${m.name}: ${m.content}`).join("\n");
  return `${basePrompt}\n\n## Recalled Memories\n${memSection}`;
}

// ─── Demo Execution ─────────────────────────────────────────────────────────

console.log("\x1b[36m第 22 章 Demo：跨会话记忆系统\x1b[0m");
console.log("\x1b[90m让 Agent 越用越聪明的三种机制\x1b[0m\n");

const tmpDir = mkdtempSync(join(tmpdir(), "memory-demo-"));
const memoryDir = join(tmpDir, ".agent-memory");
mkdirSync(memoryDir);

// ═══ 场景 1：会话记忆 — 实时笔记提取 ═══
{
  console.log("\x1b[33m═══ 场景 1：会话记忆 — 实时笔记提取 ═══\x1b[0m");
  console.log("\x1b[90m从对话中实时提取关键信息到结构化笔记\x1b[0m\n");

  const memory = createSessionMemory();

  // Simulate model responses that contain extractable info
  const modelResponses: AssistantMessage[] = [
    { content: [{ type: "text", text: "I see you're using pnpm as your package manager. Let me work on editing src/auth.ts to fix the token refresh logic." }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "text", text: "I decided to use JWT with rotating keys. Also working on src/middleware.ts for the auth guard." }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
    { content: [{ type: "text", text: "Error: the refresh token endpoint returns 401 when token is expired instead of using the refresh flow." }], stopReason: "endTurn", role: "assistant", timestamp: Date.now() } as any,
  ];

  const model = createScriptedModel(modelResponses);

  for (let i = 0; i < modelResponses.length; i++) {
    const ctx: Context = { systemPrompt: "", messages: [], tools: [] };
    const stream = model.next(ctx);
    for await (const _ of stream) {}
    const reply = stream.result();

    const text = reply.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") ?? "";
    const extracted = extractMemoryFromText(text, memory);

    if (extracted.length > 0) {
      console.log(`  \x1b[32m轮次 ${i + 1} 提取到：\x1b[0m`);
      extracted.forEach(e => console.log(`    ${e}`));
    }
  }

  console.log(`\n  \x1b[90m── 当前会话笔记 ──\x1b[0m`);
  console.log(`  ${formatSessionMemory(memory).split("\n").join("\n  ")}`);
  console.log();
}

// ═══ 场景 2：持久记忆 — 写入/读取/注入 ═══
{
  console.log("\x1b[33m═══ 场景 2：持久记忆 — 写入/读取/注入 ═══\x1b[0m");
  console.log("\x1b[90m将重要信息持久化为 markdown，下次会话自动加载\x1b[0m\n");

  // Write memories from "previous session"
  const memories: MemoryFile[] = [
    { name: "user-prefers-pnpm", type: "user", created: "2025-01-15", content: "User always uses pnpm. Never suggest npm install." },
    { name: "project-auth-jwt", type: "project", created: "2025-01-15", content: "Auth system uses JWT with RS256. Keys rotate weekly." },
    { name: "feedback-no-semicolons", type: "feedback", created: "2025-01-15", content: "Code style: no semicolons, single quotes, 2-space indent." },
  ];

  console.log("  \x1b[90m写入 3 条持久记忆...\x1b[0m");
  for (const mem of memories) {
    const path = writeMemory(memoryDir, mem);
    console.log(`    ✓ ${mem.name} → ${path.replace(tmpDir, "<memory>")}`);
  }

  // Read them back (simulating new session)
  console.log("\n  \x1b[90m新会话加载记忆...\x1b[0m");
  const loaded = loadAllMemories(memoryDir);
  console.log(`    加载了 ${loaded.length} 条记忆`);

  // Inject into system prompt
  const basePrompt = "You are a helpful coding assistant.";
  const enhanced = buildSystemPromptWithMemory(basePrompt, loaded);

  console.log(`\n  \x1b[90m── 增强后的 System Prompt ──\x1b[0m`);
  console.log(`  ${enhanced.split("\n").join("\n  ")}`);
  console.log();
}

// ═══ 场景 3：上下文压缩 — 记忆作为锚点 ═══
{
  console.log("\x1b[33m═══ 场景 3：上下文压缩 — 记忆作为锚点 ═══\x1b[0m");
  console.log("\x1b[90m当上下文被压缩时，记忆确保关键信息不丢失\x1b[0m\n");

  // Simulate a long conversation that gets compacted
  const originalMessages = [
    "User asked to set up auth system",
    "Discussed JWT vs session tokens, decided JWT",
    "Implemented src/auth.ts with RS256",
    "Fixed bug in token refresh (was returning 401)",
    "User prefers pnpm, no semicolons",
    "Added rate limiting to auth endpoints",
    "Refactored middleware to use auth guard pattern",
  ];

  console.log("  \x1b[90m原始对话（7 轮）：\x1b[0m");
  originalMessages.forEach((m, i) => console.log(`    ${i + 1}. ${m}`));

  // Compact: only keep summary
  const compactedSummary = "Previously: set up JWT auth with RS256, implemented token refresh, added rate limiting.";

  // But memories persist independently
  const persistedMemories = loadAllMemories(memoryDir);

  console.log(`\n  \x1b[90m压缩后：\x1b[0m`);
  console.log(`    摘要: "${compactedSummary}"`);
  console.log(`    持久记忆: ${persistedMemories.length} 条（不受压缩影响）`);

  // Build the post-compaction context
  const postCompactionPrompt = buildSystemPromptWithMemory(
    `You are a helpful coding assistant.\n\n## Conversation Summary\n${compactedSummary}`,
    persistedMemories,
  );

  console.log(`\n  \x1b[32m→ 压缩丢失了细节，但记忆保留了：\x1b[0m`);
  console.log(`    ✓ 用户偏好 pnpm（不会建议 npm）`);
  console.log(`    ✓ JWT 使用 RS256，密钥每周轮换`);
  console.log(`    ✓ 代码风格：无分号，单引号`);
  console.log(`    → 这些信息在摘要中可能被省略，但记忆系统保证了它们的存活`);
  console.log();
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\x1b[33m═══ 记忆系统总结 ═══\x1b[0m\n");
console.log("  机制                  作用                          生命周期");
console.log("  ─────────────────────────────────────────────────────────────────");
console.log("  会话记忆（提取）      实时从对话中捕获关键信息      单次会话");
console.log("  持久记忆（文件）      结构化存储，跨会话加载        永久（手动管理）");
console.log("  记忆注入（Prompt）    将记忆融入 system prompt      每次请求");
console.log("  压缩锚点              上下文压缩时保留关键知识      跨压缩周期");
console.log();
console.log("\x1b[90m关键认知：Agent 的智慧不只在模型参数里，也在它积累的记忆中。\x1b[0m\n");

// Cleanup
rmSync(tmpDir, { recursive: true, force: true });
