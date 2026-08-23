/**
 * 会话持久化 — JSONL 格式
 *
 * 设计参考 Pi 的 Session 持久化：
 * - JSONL（每行一条消息），支持增量追加
 * - 崩溃安全（写到一半断电不会损坏已有数据）
 * - 简单恢复（逐行解析即可重建会话）
 */

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

/**
 * 列出所有会话
 */
export function listSessions(): string[] {
	const dir = join(process.cwd(), SESSIONS_DIR);
	if (!existsSync(dir)) return [];

	const { readdirSync } = require("node:fs");
	return readdirSync(dir)
		.filter((f: string) => f.endsWith(".jsonl"))
		.map((f: string) => f.replace(".jsonl", ""));
}

function generateSessionId(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10); // 2024-01-15
	const time = now.toISOString().slice(11, 19).replace(/:/g, ""); // 143022
	const rand = Math.random().toString(36).slice(2, 6);
	return `${date}_${time}_${rand}`;
}
