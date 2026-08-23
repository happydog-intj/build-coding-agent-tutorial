/**
 * 第 11 章：会话树 — 分支、回溯与 DAG
 *
 * 演示 messages 从线性数组演化为树形 DAG：
 * - 每条消息有 id + parentId
 * - 从任意节点 fork 出新分支
 * - /edit N 编辑历史消息（= fork）
 * - /retry 重新生成回复
 * - /branches 列出分支，/switch N 切换
 *
 * 运行方式：
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx main.ts
 *
 * 命令：
 *   /edit N 新内容   — 编辑第 N 条用户消息（自动 fork）
 *   /retry           — 重新生成最近的回复
 *   /branches        — 列出当前节点的分支
 *   /switch N        — 切换到第 N 个分支
 *   /tree            — 打印整棵树
 *   /path            — 打印当前 active path
 */

import * as readline from "node:readline";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { Context, Message } from "@earendil-works/pi-ai";
import { randomBytes } from "node:crypto";

// ─── 初始化 ──────────────────────────────────────────────────────────────────────
const models = builtinModels();
const model = process.env.ANTHROPIC_API_KEY
  ? getBuiltinModel("anthropic", "claude-sonnet-4-20250514")
  : getBuiltinModel("openai", "gpt-4o");

// ─── 会话树数据结构 ──────────────────────────────────────────────────────────────

interface StoredMessage {
  id: string;
  parentId: string | null;
  message: Message;
}

function genId(): string {
  return randomBytes(4).toString("hex");
}

class SessionTree {
  store: StoredMessage[] = [];
  currentLeafId: string | null = null;

  /** 添加一条消息到当前叶子之后 */
  append(message: Message): StoredMessage {
    const node: StoredMessage = {
      id: genId(),
      parentId: this.currentLeafId,
      message,
    };
    this.store.push(node);
    this.currentLeafId = node.id;
    return node;
  }

  /** 从指定节点 fork（编辑 = fork） */
  fork(fromNodeId: string, message: Message): StoredMessage {
    const targetNode = this.store.find(n => n.id === fromNodeId);
    if (!targetNode) throw new Error(`Node ${fromNodeId} not found`);

    const newNode: StoredMessage = {
      id: genId(),
      parentId: targetNode.parentId,  // 和原节点共享同一个父节点
      message,
    };
    this.store.push(newNode);
    this.currentLeafId = newNode.id;
    return newNode;
  }

  /** 获取从根到当前叶子的 active path */
  getActivePath(): Message[] {
    if (!this.currentLeafId) return [];
    return this.getPathTo(this.currentLeafId);
  }

  getPathTo(leafId: string): Message[] {
    const path: Message[] = [];
    let currentId: string | null = leafId;
    while (currentId !== null) {
      const node = this.store.find(n => n.id === currentId);
      if (!node) break;
      path.unshift(node.message);
      currentId = node.parentId;
    }
    return path;
  }

  /** 获取某个节点的所有子分支 */
  getChildren(nodeId: string): StoredMessage[] {
    return this.store.filter(n => n.parentId === nodeId);
  }

  /** 找到分支的最深叶子 */
  findDeepestLeaf(nodeId: string): string {
    const children = this.store.filter(n => n.parentId === nodeId);
    if (children.length === 0) return nodeId;
    return this.findDeepestLeaf(children[children.length - 1].id);
  }

  /** 切换到另一个分支 */
  switchTo(nodeId: string): void {
    this.currentLeafId = this.findDeepestLeaf(nodeId);
  }

  /** 获取 active path 上的节点（带 id） */
  getActivePathNodes(): StoredMessage[] {
    if (!this.currentLeafId) return [];
    const nodes: StoredMessage[] = [];
    let currentId: string | null = this.currentLeafId;
    while (currentId !== null) {
      const node = this.store.find(n => n.id === currentId);
      if (!node) break;
      nodes.unshift(node);
      currentId = node.parentId;
    }
    return nodes;
  }

  /** 回退到最近一条 user 消息的父节点（用于 retry） */
  getRetryPoint(): string | null {
    const nodes = this.getActivePathNodes();
    // 从尾部找最近的 assistant 节点
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].message.role === "assistant") {
        return nodes[i].parentId;
      }
    }
    return null;
  }
}

// ─── 调用模型 ────────────────────────────────────────────────────────────────────

async function callModel(tree: SessionTree): Promise<void> {
  const messages = tree.getActivePath();
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Reply in Chinese. Be concise.",
    messages,
  };

  const stream = models.streamSimple(model, context);
  for await (const e of stream) {
    if (e.type === "text_delta") process.stdout.write(e.delta);
  }
  const reply = stream.result();
  tree.append(reply);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────

console.log(`\x1b[36m第 11 章 Demo：Session Tree\x1b[0m [${model.id}]`);
console.log(`\x1b[90mCommands: /edit N text | /retry | /branches | /switch N | /tree | /path | /quit\x1b[0m\n`);

const tree = new SessionTree();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

while (true) {
  const input = await question("\x1b[36m> \x1b[0m");
  const trimmed = input.trim();
  if (!trimmed) continue;
  if (trimmed === "/quit") break;

  // /tree — 打印整棵树
  if (trimmed === "/tree") {
    console.log(`\n\x1b[90m--- Tree (${tree.store.length} nodes) ---\x1b[0m`);
    for (const node of tree.store) {
      const isCurrent = node.id === tree.currentLeafId ? " ←" : "";
      const content = node.message.role === "assistant"
        ? (node.message as any).content?.[0]?.text?.slice(0, 30) ?? "[tool]"
        : typeof node.message.content === "string" ? node.message.content.slice(0, 30) : "[complex]";
      console.log(`  ${node.id} (parent:${node.parentId ?? "root"}) \x1b[33m${node.message.role}\x1b[0m: ${content}${isCurrent}`);
    }
    console.log();
    continue;
  }

  // /path — 打印当前 active path
  if (trimmed === "/path") {
    const nodes = tree.getActivePathNodes();
    console.log(`\n\x1b[90m--- Active Path (${nodes.length} messages) ---\x1b[0m`);
    nodes.forEach((n, i) => {
      const content = n.message.role === "assistant"
        ? (n.message as any).content?.[0]?.text?.slice(0, 40) ?? "[tool]"
        : typeof n.message.content === "string" ? n.message.content.slice(0, 40) : "[complex]";
      console.log(`  [${i}] ${n.id} \x1b[33m${n.message.role}\x1b[0m: ${content}`);
    });
    console.log();
    continue;
  }

  // /branches — 列出当前节点的兄弟分支
  if (trimmed === "/branches") {
    const nodes = tree.getActivePathNodes();
    if (nodes.length < 2) { console.log("  \x1b[90mNo branches yet\x1b[0m\n"); continue; }
    const currentNode = nodes[nodes.length - 1];
    const siblings = tree.store.filter(n => n.parentId === currentNode.parentId);
    console.log(`\n\x1b[90m--- Branches from parent ${currentNode.parentId} ---\x1b[0m`);
    siblings.forEach((s, i) => {
      const isCurrent = s.id === currentNode.id ? " \x1b[32m← current\x1b[0m" : "";
      const content = typeof s.message.content === "string" ? s.message.content.slice(0, 40) : "[complex]";
      console.log(`  [${i}] ${s.id} \x1b[33m${s.message.role}\x1b[0m: ${content}${isCurrent}`);
    });
    console.log();
    continue;
  }

  // /switch N — 切换分支
  if (trimmed.startsWith("/switch ")) {
    const idx = parseInt(trimmed.slice(8));
    const nodes = tree.getActivePathNodes();
    const currentNode = nodes[nodes.length - 1];
    const siblings = tree.store.filter(n => n.parentId === currentNode.parentId);
    if (idx >= 0 && idx < siblings.length) {
      tree.switchTo(siblings[idx].id);
      console.log(`\x1b[32mSwitched to branch ${siblings[idx].id}\x1b[0m\n`);
    } else {
      console.log(`\x1b[31mInvalid index. Use /branches to see options.\x1b[0m\n`);
    }
    continue;
  }

  // /edit N content — 编辑第 N 条 user 消息
  if (trimmed.startsWith("/edit ")) {
    const match = trimmed.match(/^\/edit\s+(\d+)\s+(.+)$/);
    if (!match) { console.log("\x1b[90mUsage: /edit N new content\x1b[0m\n"); continue; }
    const idx = parseInt(match[1]);
    const newContent = match[2];

    const pathNodes = tree.getActivePathNodes();
    const userNodes = pathNodes.filter(n => n.message.role === "user");
    if (idx < 0 || idx >= userNodes.length) {
      console.log(`\x1b[31mUser message index out of range (0..${userNodes.length - 1})\x1b[0m\n`);
      continue;
    }

    // fork：在同一个 parentId 下创建新节点
    const targetNode = userNodes[idx];
    console.log(`\x1b[35mForking from node ${targetNode.id} (parent: ${targetNode.parentId})\x1b[0m`);
    tree.fork(targetNode.id, { role: "user", content: newContent, timestamp: Date.now() });
    console.log(`\x1b[35mNew branch created. Calling model...\x1b[0m\n`);
    await callModel(tree);
    console.log("\n");
    continue;
  }

  // /retry — 重新生成
  if (trimmed === "/retry") {
    const pathNodes = tree.getActivePathNodes();
    // 找最近的 assistant，回到它的 parent（user），重新调用
    const lastAssistant = [...pathNodes].reverse().find(n => n.message.role === "assistant");
    if (!lastAssistant) { console.log("\x1b[90mNothing to retry\x1b[0m\n"); continue; }

    // 切回 assistant 的 parent（即 user 节点）
    tree.currentLeafId = lastAssistant.parentId;
    console.log(`\x1b[35mRetrying from ${lastAssistant.parentId}...\x1b[0m\n`);
    await callModel(tree);
    console.log("\n");
    continue;
  }

  // 普通输入 — append + 调用模型
  tree.append({ role: "user", content: trimmed, timestamp: Date.now() });
  console.log();
  await callModel(tree);
  console.log("\n");
}

rl.close();
console.log(`\x1b[90m[Tree: ${tree.store.length} total nodes]\x1b[0m`);
