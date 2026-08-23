/**
 * 工具注册 — 导出所有可用工具
 */

import type { MiniTool } from "../agent-loop.js";
import { bashTool } from "./bash.js";
import { editFileTool } from "./edit.js";
import { readFileTool } from "./read.js";
import { writeFileTool } from "./write.js";

/** 所有可用工具（顺序即为 system prompt 中的展示顺序） */
export const allTools: MiniTool[] = [readFileTool, writeFileTool, editFileTool, bashTool];
