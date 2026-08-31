// OpenAIProvider — модели OpenAI (и OpenAI-совместимые API через OPENAI_BASE_URL) через
// официальный SDK, Chat Completions + function calling.
//
// Отличия от AnthropicProvider, о которых стоит знать:
//   * кэш промпта у OpenAI автоматический (стабильный префикс — system + tools) — флаг
//     cacheable не используется; факт попадания виден в usage.cacheRead (cached_tokens);
//   * глубина рассуждений (reasoning_effort) есть только у reasoning-моделей (gpt-5*, o*);
//     для остальных параметр не передаётся — иначе 400;
//   * результаты инструментов — отдельные сообщения role=tool, по одному на вызов, и все они
//     обязаны идти сразу за сообщением ассистента с tool_calls. Это тот же инвариант, что у
//     Anthropic (tool_use → tool_result), поэтому самовосстановление истории в workflow
//     работает и здесь;
//   * raw ответа — сообщение ассистента с tool_calls (аргументы — строкой JSON как их отдала
//     модель); при воспроизведении истории оно берётся как есть. Если raw пришёл от другого
//     провайдера (массив блоков Anthropic), история собирается из text/toolCalls — так диалог,
//     начатый на Claude, продолжается на OpenAI без ошибок формата.

import OpenAI from "openai";
import { noteLlmError, noteLlmSuccess } from "./health.ts";
import type { ChatMessage, LLMProvider, LLMRequest, LLMResponse, ToolCall } from "./provider.ts";
import { LLMError } from "./provider.ts";

export type OpenAIOptions = {
	apiKey: string;
	model: string;
	baseURL?: string;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	timeoutMs?: number;
	/** Подмена клиента в тестах. */
	client?: ChatClient;
};

export type ChatClient = {
	chat: { completions: { create(params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming): Promise<OpenAI.Chat.ChatCompletion> } };
};

type AssistantRaw = { role: "assistant"; content: string | null; tool_calls?: OpenAI.Chat.ChatCompletionMessageToolCall[] };

/** Reasoning-модели принимают reasoning_effort; остальным его передавать нельзя. */
export function isReasoningModel(model: string): boolean {
	return /^(gpt-5|o\d)/i.test(model);
}

export function reasoningEffort(effort: OpenAIOptions["effort"]): "low" | "medium" | "high" {
	if (effort === "low") return "low";
	if (effort === "medium" || effort === undefined) return "medium";
	return "high";
}

export class OpenAIProvider implements LLMProvider {
	readonly name = "openai";
	private readonly client: ChatClient;
	private readonly model: string;
	private readonly effort: NonNullable<OpenAIOptions["effort"]>;

	constructor(opts: OpenAIOptions) {
		this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL || undefined, timeout: opts.timeoutMs ?? 120_000, maxRetries: 2 });
		this.model = opts.model;
		this.effort = opts.effort ?? "medium";
	}

	async chat(req: LLMRequest): Promise<LLMResponse> {
		const tools: OpenAI.Chat.ChatCompletionTool[] = req.tools.map((t) => ({
			type: "function",
			function: { name: t.name, description: t.description, parameters: t.inputSchema },
		}));

		let response: OpenAI.Chat.ChatCompletion;
		try {
			response = await this.client.chat.completions.create({
				model: this.model,
				messages: toMessages(req.system, req.messages),
				tools,
				max_completion_tokens: req.maxTokens ?? 4096,
				...(isReasoningModel(this.model) ? { reasoning_effort: reasoningEffort(this.effort) } : {}),
			});
		} catch (e) {
			const err = mapError(e);
			noteLlmError(err.code, err.message);
			throw err;
		}
		noteLlmSuccess();

		const choice = response.choices[0];
		if (!choice) throw new LLMError("LLM_ERROR", "Модель вернула пустой ответ");
		const msg = choice.message;
		const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
			.filter((c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === "function")
			.map((c) => ({ id: c.id, name: c.function.name, input: parseArguments(c.function.arguments) }));
		const raw: AssistantRaw = { role: "assistant", content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) };

		return {
			text: (msg.content ?? "").trim(),
			toolCalls,
			stopReason: stopReason(choice.finish_reason, toolCalls.length > 0),
			raw,
			model: response.model,
			usage: {
				inputTokens: response.usage?.prompt_tokens ?? 0,
				outputTokens: response.usage?.completion_tokens ?? 0,
				cacheRead: response.usage?.prompt_tokens_details?.cached_tokens ?? undefined,
			},
		};
	}
}

/** История диалога → сообщения Chat Completions. */
export function toMessages(system: string, history: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
	const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: system }];
	for (const m of history) {
		if (m.role === "assistant") {
			out.push(assistantParam(m));
		} else if ("toolResults" in m) {
			for (const r of m.toolResults) {
				out.push({ role: "tool", tool_call_id: r.toolCallId, content: typeof r.content === "string" ? r.content : JSON.stringify(r.content) });
			}
		} else {
			out.push({ role: "user", content: m.text });
		}
	}
	return out;
}

function assistantParam(m: Extract<ChatMessage, { role: "assistant" }>): OpenAI.Chat.ChatCompletionAssistantMessageParam {
	const raw = m.raw as Partial<AssistantRaw> | unknown[] | undefined;
	if (raw && !Array.isArray(raw) && typeof raw === "object" && raw.role === "assistant") {
		const calls = (raw.tool_calls ?? []).filter((c) => c.type === "function");
		return { role: "assistant", content: raw.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) };
	}
	const calls = m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } }));
	return { role: "assistant", content: m.text || null, ...(calls.length ? { tool_calls: calls } : {}) };
}

/** Аргументы функции — строка JSON от модели; обрезанный или пустой JSON → пустой вход. */
export function parseArguments(s: string): Record<string, unknown> {
	if (!s || !s.trim()) return {};
	try {
		const v = JSON.parse(s) as unknown;
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function stopReason(finish: string | null | undefined, hasTools: boolean): string {
	if (finish === "tool_calls" || (finish === "stop" && hasTools)) return "tool_use";
	if (finish === "stop" || finish == null) return "end_turn";
	if (finish === "length") return "max_tokens";
	if (finish === "content_filter") return "refusal";
	return finish;
}

function mapError(e: unknown): LLMError {
	if (e instanceof OpenAI.AuthenticationError) return new LLMError("LLM_AUTH", "Неверный ключ OpenAI");
	if (e instanceof OpenAI.RateLimitError) {
		// 429 у OpenAI — и лимит запросов, и исчерпанная квота (insufficient_quota); второе не лечится повтором.
		const text = e.message.toLowerCase();
		if (text.includes("quota") || text.includes("billing") || text.includes("credit")) return new LLMError("LLM_QUOTA", e.message);
		return new LLMError("LLM_RATE_LIMIT", "Превышен лимит запросов к модели", true);
	}
	if (e instanceof OpenAI.BadRequestError) return new LLMError("LLM_BAD_REQUEST", e.message);
	if (e instanceof OpenAI.APIConnectionError) return new LLMError("LLM_UNAVAILABLE", "Сервис модели недоступен", true);
	if (e instanceof OpenAI.APIError) return new LLMError("LLM_ERROR", `Ошибка модели (${e.status})`, (e.status ?? 0) >= 500);
	return new LLMError("LLM_ERROR", e instanceof Error ? e.message : String(e));
}
