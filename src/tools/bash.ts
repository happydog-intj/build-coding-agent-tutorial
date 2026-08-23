/**
 * bash 工具 — 执行 shell 命令
 *
 * 设计参考 Pi 的 bash tool：
 * - 超时控制（默认 30 秒）
 * - 输出截断（防止超大输出撑爆上下文）
 * - 合并 stdout/stderr
 */

import { exec } from "node:child_process";
import type { MiniTool } from "../agent-loop.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 10_000;

export const bashTool: MiniTool = {
	name: "bash",
	description:
		"Execute a shell command and return its output (stdout + stderr combined). " +
		"Commands time out after 30 seconds. Use for running tests, installing packages, " +
		"listing files, git operations, etc.",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string", description: "Shell command to execute" },
			timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
		},
		required: ["command"],
	},
	async execute(params) {
		const timeout = params.timeout ?? DEFAULT_TIMEOUT_MS;

		return new Promise<{ content: string; isError?: boolean }>((resolve) => {
			exec(
				params.command,
				{
					timeout,
					maxBuffer: 1024 * 1024, // 1MB buffer
					shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
					env: { ...process.env, TERM: "dumb" }, // 禁用颜色输出
				},
				(error, stdout, stderr) => {
					let output = "";

					if (stdout) output += stdout;
					if (stderr) output += (output ? "\n" : "") + stderr;

					// 超时处理
					if (error && "killed" in error && error.killed) {
						resolve({
							content: `Command timed out after ${timeout}ms.\nPartial output:\n${truncateOutput(output)}`,
							isError: true,
						});
						return;
					}

					// 非零退出码
					if (error && !output) {
						resolve({
							content: `Command failed: ${error.message}`,
							isError: true,
						});
						return;
					}

					// 截断过长输出
					const truncated = truncateOutput(output || "(no output)");
					const isError = error !== null;

					if (isError) {
						resolve({ content: `Exit code: ${error!.code ?? 1}\n${truncated}`, isError: true });
					} else {
						resolve({ content: truncated });
					}
				},
			);
		});
	},
};

function truncateOutput(output: string): string {
	if (output.length <= MAX_OUTPUT_CHARS) return output;

	const half = Math.floor(MAX_OUTPUT_CHARS / 2);
	const head = output.slice(0, half);
	const tail = output.slice(-half);
	const omitted = output.length - MAX_OUTPUT_CHARS;

	return `${head}\n\n... (${omitted} characters omitted) ...\n\n${tail}`;
}
