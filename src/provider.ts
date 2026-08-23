/**
 * Provider 初始化 — 使用 pi-ai 的 Models 系统
 *
 * Pi-ai 提供了 30+ LLM provider 的统一接口。
 * 使用 builtinModels() 一次性注册所有内置 provider，
 * 认证通过环境变量自动解析（ANTHROPIC_API_KEY / OPENAI_API_KEY 等）。
 */

import { type Api, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";

export interface ProviderSetup {
	models: MutableModels;
	model: Model<Api>;
}

/**
 * 初始化 LLM provider。
 *
 * 模型选择优先级：
 * 1. --model CLI 参数
 * 2. PI_MODEL 环境变量
 * 3. 根据可用 API key 自动选择默认模型
 */
export function setupProvider(modelId?: string): ProviderSetup {
	// builtinModels() = createModels() + 注册所有内置 provider
	// 认证通过环境变量自动解析，无需手动配置
	const models = builtinModels();

	const selectedModelId = modelId ?? process.env.PI_MODEL ?? detectDefaultModel();

	// 尝试从内置模型目录中获取（带完整元数据）
	const model = resolveModel(selectedModelId);

	return { models, model };
}

/**
 * 解析模型 ID 为 Model 对象
 */
function resolveModel(modelId: string): Model<Api> {
	// 已知模型的快速映射（provider + modelId → 完整 Model 对象）
	const KNOWN: Array<[string, () => Model<Api> | undefined]> = [
		["claude-sonnet-4-20250514", () => getBuiltinModel("anthropic", "claude-sonnet-4-20250514")],
		["claude-haiku-3-5-20241022", () => getBuiltinModel("anthropic", "claude-haiku-3-5-20241022")],
		["gpt-4o", () => getBuiltinModel("openai", "gpt-4o")],
		["gpt-4o-mini", () => getBuiltinModel("openai", "gpt-4o-mini")],
	];

	for (const [id, getter] of KNOWN) {
		if (modelId === id) {
			const m = getter();
			if (m) return m;
		}
	}

	// 未知模型：构造一个基础 Model 对象，猜测 provider
	const provider = detectProviderFromKey();
	const api = (provider === "openai" ? "openai-responses" : "anthropic-messages") as Api;
	const baseUrl = provider === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com";

	return {
		id: modelId,
		name: modelId,
		provider,
		api,
		baseUrl,
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0 },
		contextWindow: 200_000,
		maxTokens: 8192,
	} as unknown as Model<Api>;
}

function detectDefaultModel(): string {
	if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-20250514";
	if (process.env.OPENAI_API_KEY) return "gpt-4o";
	throw new Error(
		"No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.\n" +
			"Or specify a model with --model <model-id> or PI_MODEL env var.",
	);
}

function detectProviderFromKey(): string {
	if (process.env.ANTHROPIC_API_KEY) return "anthropic";
	if (process.env.OPENAI_API_KEY) return "openai";
	return "anthropic";
}
