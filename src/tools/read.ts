/**
 * read_file 工具 — 读取文件内容并返回带行号的文本
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MiniTool } from "../agent-loop.js";

export const readFileTool: MiniTool = {
	name: "read_file",
	description:
		"Read file contents. Returns line-numbered text. Use offset and limit to read specific portions of large files.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path to read (relative to cwd or absolute)" },
			offset: { type: "number", description: "Start line number (1-indexed). Default: 1" },
			limit: { type: "number", description: "Maximum number of lines to read. Default: all" },
		},
		required: ["path"],
	},
	async execute(params) {
		const filePath = resolve(params.path);

		let content: string;
		try {
			content = await readFile(filePath, "utf-8");
		} catch (err: any) {
			if (err.code === "ENOENT") {
				return { content: `File not found: ${params.path}`, isError: true };
			}
			if (err.code === "EISDIR") {
				return { content: `Path is a directory, not a file: ${params.path}`, isError: true };
			}
			return { content: `Cannot read file: ${err.message}`, isError: true };
		}

		const lines = content.split("\n");
		const offset = Math.max(1, params.offset ?? 1);
		const limit = params.limit ?? lines.length;
		const slice = lines.slice(offset - 1, offset - 1 + limit);

		// 带行号输出（与 Pi 的 read tool 格式一致）
		const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join("\n");

		const totalLines = lines.length;
		let header = `${filePath} (${totalLines} lines)`;
		if (offset > 1 || limit < totalLines) {
			header += ` [showing lines ${offset}-${Math.min(offset + slice.length - 1, totalLines)}]`;
		}

		return { content: `${header}\n${numbered}` };
	},
};
