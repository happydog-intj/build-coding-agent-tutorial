/**
 * Mini Pi Coding Agent — CLI 入口
 *
 * 一个最小化的 coding agent 实现，展示核心原理：
 * - 流式 LLM 调用（通过 pi-ai）
 * - Agent Loop（手写简化版）
 * - 4 个核心工具（read/write/edit/bash）
 * - JSONL 会话持久化
 */

import * as readline from "node:readline";
import type { Message } from "@earendil-works/pi-ai";
import { runAgent, type AgentConfig } from "./agent-loop.js";
import { setupProvider } from "./provider.js";
import { appendMessage, getSessionPath, loadSession } from "./session.js";
import { allTools } from "./tools/index.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a coding assistant that helps users with software development tasks.
You have access to tools for reading, writing, and editing files, as well as running shell commands.

Guidelines:
- Use read_file to examine files before making changes
- Use edit_file for targeted edits (preferred over write_file for existing files)
- Use write_file for creating new files
- Use bash for running commands (tests, git, package managers, etc.)
- When encountering errors, try to fix them rather than giving up
- Be concise in explanations but thorough in code changes

Current working directory: ${process.cwd()}`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	// 解析 CLI 参数
	const args = process.argv.slice(2);
	const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];
	const resumeArg = args.find((a) => a.startsWith("--resume="))?.split("=")[1];

	// 初始化 provider
	let providerSetup;
	try {
		providerSetup = setupProvider(modelArg);
	} catch (err: any) {
		console.error(`\x1b[31m${err.message}\x1b[0m`);
		process.exit(1);
	}

	const { models, model } = providerSetup;

	// 会话管理
	const sessionFile = getSessionPath(resumeArg);
	let messages: Message[] = resumeArg ? loadSession(sessionFile) : [];

	// 打印启动信息
	console.log("\x1b[36m╭─────────────────────────────────────╮\x1b[0m");
	console.log("\x1b[36m│\x1b[0m  \x1b[1mMini Pi Coding Agent\x1b[0m              \x1b[36m│\x1b[0m");
	console.log("\x1b[36m│\x1b[0m  Model: \x1b[33m%-27s\x1b[0m \x1b[36m│\x1b[0m", model.id);
	console.log("\x1b[36m│\x1b[0m  Tools: read, write, edit, bash     \x1b[36m│\x1b[0m");
	console.log("\x1b[36m│\x1b[0m  Type /quit to exit                 \x1b[36m│\x1b[0m");
	console.log("\x1b[36m╰─────────────────────────────────────╯\x1b[0m");
	console.log();

	if (messages.length > 0) {
		console.log(`\x1b[90mResumed session with ${messages.length} messages\x1b[0m\n`);
	}

	// Agent 配置
	const config: AgentConfig = {
		model,
		streamFn: (m, ctx, opts) => models.streamSimple(m, ctx, opts),
		tools: allTools,
		systemPrompt: SYSTEM_PROMPT,
		onText: (text) => process.stdout.write(text),
		onThinking: (text) => process.stdout.write(`\x1b[90m${text}\x1b[0m`),
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

	// readline 交互循环
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const question = (prompt: string): Promise<string> =>
		new Promise((resolve) => rl.question(prompt, resolve));

	while (true) {
		const input = await question("\x1b[36m> \x1b[0m");
		const trimmed = input.trim();

		if (!trimmed) continue;
		if (trimmed === "/quit" || trimmed === "/exit") break;

		if (trimmed === "/clear") {
			messages = [];
			console.log("\x1b[90mSession cleared\x1b[0m\n");
			continue;
		}

		if (trimmed === "/session") {
			console.log(`\x1b[90mMessages: ${messages.length} | File: ${sessionFile}\x1b[0m\n`);
			continue;
		}

		console.log(); // 空行分隔

		// 运行 agent
		const prevLength = messages.length;
		await runAgent(trimmed, messages, config);

		// 持久化新消息
		for (let i = prevLength; i < messages.length; i++) {
			appendMessage(sessionFile, messages[i]);
		}

		console.log("\n"); // 回答结束后空行
	}

	rl.close();
	console.log("\x1b[90mGoodbye!\x1b[0m");
}

function formatToolArgs(name: string, args: any): string {
	switch (name) {
		case "read_file":
		case "write_file":
		case "edit_file":
			return args.path ?? "";
		case "bash":
			return args.command?.slice(0, 60) ?? "";
		default:
			return JSON.stringify(args).slice(0, 60);
	}
}

main().catch((err) => {
	console.error("\x1b[31mFatal error:\x1b[0m", err.message);
	process.exit(1);
});
