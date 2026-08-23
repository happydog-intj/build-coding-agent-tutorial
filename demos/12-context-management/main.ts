/**
 * 第 12 章：上下文窗口管理 — 历史不动，上下文按预算重建
 *
 * 演示：
 * - Session（完整历史）vs Context（按预算裁剪后的输入）
 * - 交互分组：toolCall + toolResult 不可拆分
 * - 从后向前按预算保留最近的交互
 * - 被截断的旧历史压缩为摘要注入 systemPrompt
 *
 * 这个 demo 不需要 API key — 用录播模型演示截断逻辑。
 *
 * 运行方式：
 *   npx tsx main.ts
 *   npx tsx main.ts --budget=500    ← 设置极小预算观察截断
 *   npx tsx main.ts --budget=10000  ← 大预算不截断
 */

import type { Message } from "@earendil-works/pi-ai";

// ─── Token 估算 ─────────────────────────────────────────────────────────────────

function estimateTokens(input: string | Message[]): number {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  // 粗略：~3 字符/token（略微高估，宁可留余量）
  return Math.ceil(text.length / 3);
}

// ─── 交互分组 ────────────────────────────────────────────────────────────────────

interface Interaction {
  messages: Message[];
  tokenCount: number;
}

function groupIntoInteractions(messages: Message[]): Interaction[] {
  const groups: Interaction[] = [];
  let current: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "user" && current.length > 0) {
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

// ─── Context 构建（按预算截断） ──────────────────────────────────────────────────

interface ContextBuildResult {
  systemPrompt: string;
  messages: Message[];
  stats: {
    totalInteractions: number;
    keptInteractions: number;
    truncatedInteractions: number;
    totalTokens: number;
    keptTokens: number;
    budgetUsed: number;
  };
}

function buildContext(session: Message[], budget: number, systemPrompt: string): ContextBuildResult {
  const interactions = groupIntoInteractions(session);

  // 1. system prompt 占用的预算
  let used = estimateTokens(systemPrompt);

  // 2. 从后向前保留交互
  let keepFrom = interactions.length;
  for (let i = interactions.length - 1; i >= 0; i--) {
    const cost = interactions[i].tokenCount;
    if (used + cost > budget * 0.8) break;  // 留 20% 给摘要和输出
    keepFrom = i;
    used += cost;
  }

  const truncated = interactions.slice(0, keepFrom);
  const kept = interactions.slice(keepFrom);

  // 3. 生成摘要（简单规则版：提取 user 消息关键词）
  let enhancedPrompt = systemPrompt;
  if (truncated.length > 0) {
    const summaryParts = truncated.map(inter => {
      const userMsg = inter.messages.find(m => m.role === "user");
      if (userMsg && typeof userMsg.content === "string") {
        return userMsg.content.slice(0, 50);
      }
      return null;
    }).filter(Boolean);
    const summary = summaryParts.join("; ");
    enhancedPrompt += `\n\n[Earlier context (${truncated.length} interactions truncated): ${summary}]`;
  }

  const keptMessages = kept.flatMap(i => i.messages);
  const totalTokens = interactions.reduce((sum, i) => sum + i.tokenCount, 0);
  const keptTokens = kept.reduce((sum, i) => sum + i.tokenCount, 0);

  return {
    systemPrompt: enhancedPrompt,
    messages: keptMessages,
    stats: {
      totalInteractions: interactions.length,
      keptInteractions: kept.length,
      truncatedInteractions: truncated.length,
      totalTokens,
      keptTokens,
      budgetUsed: used,
    },
  };
}

// ─── 模拟一段长对话 ─────────────────────────────────────────────────────────────

function createLongSession(): Message[] {
  const now = Date.now();
  const messages: Message[] = [];

  // 模拟 8 轮对话（含工具调用）
  const conversations = [
    { user: "帮我看看 src/index.ts 的内容", hasToolCall: true, toolName: "read_file", toolResult: "// index.ts\nimport express from 'express';\nconst app = express();\napp.listen(3000);" },
    { user: "这个文件有什么问题吗？", hasToolCall: false, reply: "代码结构没问题，但缺少错误处理和路由定义。" },
    { user: "帮我加一个 /health 路由", hasToolCall: true, toolName: "edit_file", toolResult: "Successfully edited src/index.ts" },
    { user: "运行一下测试", hasToolCall: true, toolName: "bash", toolResult: "PASS src/index.test.ts\n  ✓ health endpoint returns 200 (15ms)\n\nTests: 1 passed" },
    { user: "再帮我加一个 /api/users 路由", hasToolCall: true, toolName: "edit_file", toolResult: "Successfully edited src/index.ts" },
    { user: "这个 users 路由需要连数据库吗？", hasToolCall: false, reply: "取决于你的需求。如果只是返回静态数据，不需要。如果需要 CRUD 操作，建议连接数据库。" },
    { user: "好，帮我配置一下 PostgreSQL 连接", hasToolCall: true, toolName: "write_file", toolResult: "Successfully wrote 25 lines to src/db.ts" },
    { user: "现在整体结构怎么样了？帮我总结一下", hasToolCall: true, toolName: "read_file", toolResult: "// index.ts (updated)\nimport express from 'express';\nimport { db } from './db';\n..." },
  ];

  for (const conv of conversations) {
    // user message
    messages.push({ role: "user", content: conv.user, timestamp: now });

    if (conv.hasToolCall) {
      // assistant with toolCall
      messages.push({
        role: "assistant",
        content: [{ type: "toolCall", id: `tc_${messages.length}`, name: conv.toolName!, arguments: {} }],
        stopReason: "toolUse",
        usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        model: "demo", api: "anthropic-messages", provider: "test", timestamp: now,
      } as any);

      // toolResult
      messages.push({
        role: "toolResult",
        toolCallId: `tc_${messages.length - 1}`,
        toolName: conv.toolName!,
        content: [{ type: "text", text: conv.toolResult! }],
        isError: false,
        timestamp: now,
      } as any);

      // assistant final reply
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: `已完成 ${conv.toolName} 操作。` }],
        stopReason: "stop",
        usage: { input: 150, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 160, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        model: "demo", api: "anthropic-messages", provider: "test", timestamp: now,
      } as any);
    } else {
      // assistant text reply
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: conv.reply! }],
        stopReason: "stop",
        usage: { input: 100, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 130, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        model: "demo", api: "anthropic-messages", provider: "test", timestamp: now,
      } as any);
    }
  }

  return messages;
}

// ─── Main ────────────────────────────────────────────────────────────────────────

console.log("\x1b[36m第 12 章 Demo：Context Management\x1b[0m\n");

const budgetArg = process.argv.find(a => a.startsWith("--budget="))?.split("=")[1];
const budget = budgetArg ? parseInt(budgetArg) : 1500;

const session = createLongSession();
const systemPrompt = "You are a coding assistant.";

console.log(`\x1b[90m模拟会话: ${session.length} 条消息\x1b[0m`);
console.log(`\x1b[90m预算: ${budget} tokens\x1b[0m\n`);

// 展示交互分组
const interactions = groupIntoInteractions(session);
console.log(`\x1b[33m── 交互分组 (${interactions.length} 组) ──\x1b[0m`);
for (let i = 0; i < interactions.length; i++) {
  const inter = interactions[i];
  const userMsg = inter.messages.find(m => m.role === "user");
  const userText = userMsg && typeof userMsg.content === "string" ? userMsg.content.slice(0, 40) : "?";
  const hasToolCall = inter.messages.some(m => m.role === "assistant" && (m as any).content?.some?.((c: any) => c.type === "toolCall"));
  console.log(`  [${i}] ${inter.tokenCount} tokens | ${inter.messages.length} msgs | ${hasToolCall ? "🔧" : "💬"} "${userText}"`);
}

// 构建 Context
console.log(`\n\x1b[33m── 按预算构建 Context ──\x1b[0m`);
const result = buildContext(session, budget, systemPrompt);

console.log(`  总交互: ${result.stats.totalInteractions}`);
console.log(`  保留: \x1b[32m${result.stats.keptInteractions}\x1b[0m`);
console.log(`  截断: \x1b[31m${result.stats.truncatedInteractions}\x1b[0m`);
console.log(`  总 tokens: ${result.stats.totalTokens}`);
console.log(`  保留 tokens: ${result.stats.keptTokens}`);
console.log(`  预算使用: ${result.stats.budgetUsed}/${budget}`);

// 展示截断结果
console.log(`\n\x1b[33m── 最终 Context ──\x1b[0m`);
console.log(`  systemPrompt: ${result.systemPrompt.slice(0, 80)}...`);
console.log(`  messages: ${result.messages.length} 条`);

if (result.stats.truncatedInteractions > 0) {
  console.log(`\n\x1b[33m── 摘要（注入 systemPrompt） ──\x1b[0m`);
  const summaryPart = result.systemPrompt.split("[Earlier context")[1];
  if (summaryPart) console.log(`  [Earlier context${summaryPart}`);
}

// 验证不变量
console.log(`\n\x1b[33m── 不变量检查 ──\x1b[0m`);
let valid = true;

// 检查 toolCall/toolResult 配对完整性
for (let i = 0; i < result.messages.length; i++) {
  const msg = result.messages[i] as any;
  if (msg.role === "assistant" && msg.content) {
    const calls = msg.content.filter((c: any) => c.type === "toolCall");
    for (const call of calls) {
      const hasResult = result.messages.some((m: any) => m.role === "toolResult" && m.toolCallId === call.id);
      if (!hasResult) {
        console.log(`  \x1b[31m✗ toolCall ${call.id} missing its toolResult!\x1b[0m`);
        valid = false;
      }
    }
  }
}
if (valid) console.log("  \x1b[32m✓ 所有 toolCall/toolResult 配对完整\x1b[0m");

console.log(`\n\x1b[90m提示: 试试 --budget=500 观察更激进的截断，或 --budget=10000 观察不截断\x1b[0m`);
