/**
 * write_file 工具 — 创建或覆盖文件
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MiniTool } from "../agent-loop.js";

export const writeFileTool: MiniTool = {
	name: "write_file",
	description: "Create a new file or overwrite an existing file with the provided content. Automatically creates parent directories if they don't exist.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path to write (relative to cwd or absolute)" },
			content: { type: "string", description: "Content to write to the file" },
		},
		required: ["path", "content"],
	},
	async execute(params) {
		const filePath = resolve(params.path);

		try {
			// 自动创建父目录
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, params.content, "utf-8");
		} catch (err: any) {
			return { content: `Failed to write file: ${err.message}`, isError: true };
		}

		const lineCount = params.content.split("\n").length;
		return { content: `Successfully wrote ${lineCount} lines to ${params.path}` };
	},
};
