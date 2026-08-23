/**
 * edit_file 工具 — 通过字符串替换编辑文件
 *
 * 设计参考 Pi 的 edit tool：使用精确字符串匹配而非行号，
 * 避免行号偏移导致的错误。
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MiniTool } from "../agent-loop.js";

export const editFileTool: MiniTool = {
	name: "edit_file",
	description:
		"Edit a file by replacing an exact string match with new content. " +
		"The old_string must match exactly (including whitespace and indentation). " +
		"Use read_file first to see the current content.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path to edit" },
			old_string: { type: "string", description: "Exact string to find and replace" },
			new_string: { type: "string", description: "Replacement string" },
		},
		required: ["path", "old_string", "new_string"],
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
			return { content: `Cannot read file: ${err.message}`, isError: true };
		}

		// 精确匹配检查
		const occurrences = content.split(params.old_string).length - 1;

		if (occurrences === 0) {
			// 提供有用的错误信息帮助 LLM 定位问题
			const trimmed = params.old_string.trim();
			const fuzzyMatch = content.includes(trimmed);
			let hint = "";
			if (fuzzyMatch) {
				hint = " (A trimmed version was found — check leading/trailing whitespace and indentation.)";
			}
			return {
				content: `old_string not found in ${params.path}.${hint}\nMake sure it matches the file content exactly. Use read_file to check.`,
				isError: true,
			};
		}

		if (occurrences > 1) {
			return {
				content: `old_string found ${occurrences} times in ${params.path}. It must be unique. Add more surrounding context to make it unique.`,
				isError: true,
			};
		}

		// 执行替换
		const newContent = content.replace(params.old_string, params.new_string);

		try {
			await writeFile(filePath, newContent, "utf-8");
		} catch (err: any) {
			return { content: `Failed to write file: ${err.message}`, isError: true };
		}

		return { content: `Successfully edited ${params.path}` };
	},
};
