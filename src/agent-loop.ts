/**
 * Mini Agent Loop — 简化版双循环
 *
 * 这是 Pi 项目 agent-loop.ts 的教学简化版。
 * 完整版位于 packages/agent/src/agent-loop.ts（~500 行），支持：
 * - 外层 follow-up 循环（getFollowUpMessages）
 * - steering 消息注入（getSteeringMessages）
 * - beforeToolCall/afterToolCall 拦截
 * - prepareNextTurn 动态切换模型/context
 * - transformContext 上下文窗口管理
 * - 并行工具执行
 *
 * 本简化版（~120 行）只保留核心原理：
 * 1. LLM 调用不 throw，错误通过 stopReason 编码
 * 2. 工具失败返回错误内容让 LLM 自行处理
 * 3. 循环直到 LLM 不再调用工具
 */

import type {
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	Tool,
} from "@earendil-works/pi-ai";

// ─── Types ────────────────────────────────────────────────────────────────────

/** 工具执行结果 */
export interface ToolResult {
	content: string;
	isError?: boolean;
}

/** 简化版工具定义 */
export interface MiniTool {
	name: string;
	description: string;
	parameters: object; // JSON Schema
	execute: (params: Record<string, any>) => Promise<ToolResult>;
}

/** Agent 配置 */
export interface AgentConfig {
	model: Model<any>;
	streamFn: (model: Model<any>, context: Context, options?: any) => AssistantMessageEventStream;
	tools: MiniTool[];
	systemPrompt: string;
	/** 流式文本回调（逐 token 到达时调用） */
	onText?: (text: string) => void;
	/** 工具调用开始时回调 */
	onToolCall?: (name: string, args: any) => void;
	/** 工具执行完成时回调 */
	onToolResult?: (name: string, result: ToolResult) => void;
	/** 思考内容回调 */
	onThinking?: (text: string) => void;
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

/**
 * 运行 Agent Loop。
 *
 * 核心循环逻辑：
 *   用户消息 → [LLM 调用 → 解析响应 → 有 tool calls? → 执行工具 → 结果加入上下文] → 重复
 *                                        ↓ 无 tool calls
 *                                      返回（对话结束）
 *
 * @param prompt 用户输入
 * @param messages 当前会话消息列表（会被原地修改）
 * @param config Agent 配置
 * @returns 更新后的消息列表
 */
export async function runAgent(prompt: string, messages: Message[], config: AgentConfig): Promise<Message[]> {
	// 添加用户消息
	const userMsg: Message = { role: "user", content: prompt, timestamp: Date.now() };
	messages.push(userMsg);

	// 将工具定义转换为 pi-ai 的 Tool 格式（纯 schema，无执行逻辑）
	const toolSchemas: Tool[] = config.tools.map((t) => ({
		name: t.name,
		description: t.description,
		parameters: t.parameters as any,
	}));

	// Agent loop: 持续直到 LLM 不再调用工具
	while (true) {
		// 1. 构建 LLM 上下文
		const context: Context = {
			systemPrompt: config.systemPrompt,
			messages,
			tools: toolSchemas,
		};

		// 2. 调用 LLM（流式）— 遵循 StreamFn 契约：不 throw，错误编码在流中
		const stream = config.streamFn(config.model, context);
		const assistantMsg = await consumeStream(stream, config);
		messages.push(assistantMsg);

		// 3. 错误或中断 → 退出循环
		if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
			if (assistantMsg.errorMessage) {
				config.onText?.(`\n[Error: ${assistantMsg.errorMessage}]\n`);
			}
			break;
		}

		// 4. 提取 tool calls
		const toolCalls = assistantMsg.content.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall");
		if (toolCalls.length === 0) break; // 无工具调用 = LLM 已完成回答

		// 5. 依次执行工具
		for (const tc of toolCalls) {
			config.onToolCall?.(tc.name, tc.arguments);

			const tool = config.tools.find((t) => t.name === tc.name);
			let result: ToolResult;

			if (!tool) {
				result = { content: `Unknown tool: "${tc.name}". Available: ${config.tools.map((t) => t.name).join(", ")}`, isError: true };
			} else {
				try {
					result = await tool.execute(tc.arguments);
				} catch (err) {
					// 工具抛异常 → 转为错误内容，让 LLM 决定如何处理
					result = { content: `Error executing ${tc.name}: ${err instanceof Error ? err.message : String(err)}`, isError: true };
				}
			}

			config.onToolResult?.(tc.name, result);

			// 6. 将工具结果加入消息列表
			const toolResultMsg: Message = {
				role: "toolResult",
				toolCallId: tc.id,
				toolName: tc.name,
				content: [{ type: "text", text: result.content }],
				isError: result.isError ?? false,
				timestamp: Date.now(),
			};
			messages.push(toolResultMsg);
		}
		// 回到循环顶部 → 带着工具结果再次调用 LLM
	}

	return messages;
}

/**
 * 消费流式响应，调用回调，返回最终 AssistantMessage。
 */
async function consumeStream(stream: AssistantMessageEventStream, config: AgentConfig): Promise<AssistantMessage> {
	for await (const event of stream) {
		switch (event.type) {
			case "text_delta":
				config.onText?.(event.delta);
				break;
			case "thinking_delta":
				config.onThinking?.(event.delta);
				break;
		}
	}
	return stream.result();
}
