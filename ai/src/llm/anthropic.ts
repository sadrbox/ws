// AnthropicProvider — Claude через официальный SDK.
//
// Что здесь настроено и почему:
//   * adaptive thinking — модель сама решает, сколько думать; effort из конфига (по умолчанию
//     medium: извлечение намерения из одной фразы — не задача на xhigh);
//   * prompt caching — системный промпт и описание tools одинаковы для всех запросов,
//     cache_control на них снижает цену префикса в ~10 раз; проверка — usage.cacheRead;
//   * server-side fallback при отказе модели по safety-классификатору: запрос уходит на
//     резервную модель по категории отказа, чтобы бухгалтер не получил «пустой» ответ;
//   * ответ модели сохраняется в raw — на следующем ходе история воспроизводится байт в байт
//     (thinking-блоки нужно возвращать неизменными на той же модели).

import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, LLMProvider, LLMRequest, LLMResponse, ToolCall } from "./provider.ts";
import { LLMError } from "./provider.ts";

export type AnthropicOptions = {
	apiKey: string;
	model: string;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	timeoutMs?: number;
};

type Block = Anthropic.Beta.BetaContentBlockParam | Anthropic.Beta.BetaContentBlock;

export class AnthropicProvider implements LLMProvider {
	readonly name = "anthropic";
	private readonly client: Anthropic;
	private readonly model: string;
	private readonly effort: NonNullable<AnthropicOptions["effort"]>;

	constructor(opts: AnthropicOptions) {
		this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 120_000, maxRetries: 2 });
		this.model = opts.model;
		this.effort = opts.effort ?? "medium";
	}

	async chat(req: LLMRequest): Promise<LLMResponse> {
		const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t, i) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
			// Кэш-точка на последнем инструменте закрывает весь стабильный префикс tools.
			...(req.cacheable && i === req.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
		}));

		const system: Anthropic.Beta.BetaTextBlockParam[] = [
			{ type: "text", text: req.system, ...(req.cacheable ? { cache_control: { type: "ephemeral" as const } } : {}) },
		];

		let response: Anthropic.Beta.BetaMessage;
		try {
			response = await this.client.beta.messages.create({
				model: this.model,
				max_tokens: req.maxTokens ?? 4096,
				system,
				tools,
				messages: req.messages.map(toParam),
				thinking: { type: "adaptive" },
				output_config: { effort: this.effort },
				betas: ["server-side-fallback-2026-07-01"],
				fallbacks: "default",
			} as Anthropic.Beta.MessageCreateParamsNonStreaming);
		} catch (e) {
			throw mapError(e);
		}

		const text = response.content
			.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
			.map((b) => b.text)
			.join("\n")
			.trim();
		const toolCalls: ToolCall[] = response.content
			.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
			.map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));

		return {
			text,
			toolCalls,
			stopReason: response.stop_reason ?? "end_turn",
			raw: response.content,
			model: response.model,
			usage: {
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
				cacheRead: response.usage.cache_read_input_tokens ?? undefined,
				cacheWrite: response.usage.cache_creation_input_tokens ?? undefined,
			},
		};
	}
}

/** Сообщение истории → формат Messages API. Ответы ассистента — из raw, если он есть. */
function toParam(m: ChatMessage): Anthropic.Beta.BetaMessageParam {
	if (m.role === "assistant") {
		if (Array.isArray(m.raw) && m.raw.length) {
			return { role: "assistant", content: m.raw as Block[] as Anthropic.Beta.BetaContentBlockParam[] };
		}
		const content: Anthropic.Beta.BetaContentBlockParam[] = [];
		if (m.text) content.push({ type: "text", text: m.text });
		for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
		return { role: "assistant", content };
	}
	if ("toolResults" in m) {
		return {
			role: "user",
			content: m.toolResults.map((r) => ({
				type: "tool_result",
				tool_use_id: r.toolCallId,
				content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
				...(r.isError ? { is_error: true } : {}),
			})),
		};
	}
	return { role: "user", content: m.text };
}

function mapError(e: unknown): LLMError {
	if (e instanceof Anthropic.AuthenticationError) return new LLMError("LLM_AUTH", "Неверный ключ Anthropic");
	if (e instanceof Anthropic.RateLimitError) return new LLMError("LLM_RATE_LIMIT", "Превышен лимит запросов к модели", true);
	if (e instanceof Anthropic.BadRequestError) return new LLMError("LLM_BAD_REQUEST", e.message);
	if (e instanceof Anthropic.APIConnectionError) return new LLMError("LLM_UNAVAILABLE", "Сервис модели недоступен", true);
	if (e instanceof Anthropic.APIError) return new LLMError("LLM_ERROR", `Ошибка модели (${e.status})`, (e.status ?? 0) >= 500);
	return new LLMError("LLM_ERROR", e instanceof Error ? e.message : String(e));
}
