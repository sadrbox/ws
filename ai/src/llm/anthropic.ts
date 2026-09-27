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
//     (thinking-блоки нужно возвращать неизменными на той же модели);
//   * кэш-точка и на ПОСЛЕДНЕМ сообщении (И29 аудита 26.09): раунды одного хода (до 8) и следующий ход читают
//     уже отправленную историю из кэша, а не оплачивают её заново целиком;
//   * СТРИМИНГ с общим сроком (Н9 аудита 26.09). Раньше был обычный запрос с таймаутом 120 с и двумя повторами:
//     длинный ответ (maxTokens 16000) обрывался по таймауту и повторялся — до 6 минут и тройной оплаты за один
//     раунд. Теперь повторы SDK касаются только установки соединения (до первых байт ответа), а сам ответ
//     читается потоком без повторов и не дольше общего срока хода модели.

import Anthropic from "@anthropic-ai/sdk";
import { noteLlmError, noteLlmSuccess } from "./health.ts";
import type { ChatMessage, LLMProvider, LLMRequest, LLMResponse, ToolCall } from "./provider.ts";
import { LLMError } from "./provider.ts";

export type AnthropicOptions = {
	apiKey: string;
	model: string;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	/** Сколько ждать начала ответа (заголовков потока); на это время действуют повторы SDK. */
	connectTimeoutMs?: number;
	/** Общий срок одного вызова модели, включая чтение потока. Повторов после начала ответа нет. */
	timeoutMs?: number;
};

/** Общий срок вызова модели по умолчанию: длиннее самого длинного осмысленного ответа, короче «навсегда». */
export const LLM_CALL_TIMEOUT_MS = 300_000;

type Block = Anthropic.Beta.BetaContentBlockParam | Anthropic.Beta.BetaContentBlock;

export class AnthropicProvider implements LLMProvider {
	readonly name = "anthropic";
	private readonly client: Anthropic;
	private readonly model: string;
	private readonly effort: NonNullable<AnthropicOptions["effort"]>;
	private readonly callTimeoutMs: number;

	constructor(opts: AnthropicOptions) {
		// `timeout` клиента в потоке — ожидание ПЕРВЫХ байт ответа: повторы (429, 5xx, обрыв соединения) дёшевы,
		// пока модель не начала отвечать, и за них не платят дважды.
		this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.connectTimeoutMs ?? 60_000, maxRetries: 2 });
		this.model = opts.model;
		this.effort = opts.effort ?? "medium";
		this.callTimeoutMs = opts.timeoutMs ?? LLM_CALL_TIMEOUT_MS;
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
			// Контекст организации — ПОСЛЕ кэш-точки: он меняется от хода к ходу, и в кэшируемом
			// блоке рушил бы весь префикс.
			...(req.systemExtra ? [{ type: "text" as const, text: req.systemExtra }] : []),
		];

		const messages = req.messages.map(toParam);
		if (req.cacheable) markLastForCache(messages);

		let response: Anthropic.Beta.BetaMessage;
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), this.callTimeoutMs);
		const onAbort = () => ctrl.abort();
		req.signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const stream = this.client.beta.messages.stream({
				model: this.model,
				max_tokens: req.maxTokens ?? 4096,
				system,
				// Вызов без инструментов (проверка ответа клиенту: текст → JSON) — без поля вовсе, как и у OpenAI.
				...(tools.length ? { tools } : {}),
				messages,
				thinking: { type: "adaptive" },
				output_config: { effort: this.effort },
				betas: ["server-side-fallback-2026-07-01"],
				fallbacks: "default",
			} as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming, { signal: ctrl.signal });
			response = await stream.finalMessage();
		} catch (e) {
			const err = ctrl.signal.aborted && !(e instanceof Anthropic.APIError && e.status)
				? new LLMError("LLM_TIMEOUT", `Модель не ответила за ${Math.round(this.callTimeoutMs / 1000)} с`, true)
				: mapError(e);
			noteLlmError(err.code, err.message);
			throw err;
		} finally {
			clearTimeout(timer);
			req.signal?.removeEventListener("abort", onAbort);
		}
		noteLlmSuccess();

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

/**
 * Кэш-точка на последнем блоке последнего сообщения (И29 аудита 26.09). Системный промпт и инструменты кэшировались
 * и раньше, а история — нет: каждый раунд хода и каждый следующий ход оплачивали её целиком. Точек всего три
 * (инструменты, система, история) — в пределах четырёх, которые разрешает API.
 */
export function markLastForCache(messages: Anthropic.Beta.BetaMessageParam[]): void {
	const last = messages[messages.length - 1];
	if (!last) return;
	if (typeof last.content === "string") {
		if (!last.content) return;
		last.content = [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }];
		return;
	}
	const blocks = last.content as Anthropic.Beta.BetaContentBlockParam[];
	// Блок рассуждений кэш-точкой быть не может — берём последний обычный.
	for (let i = blocks.length - 1; i >= 0; i--) {
		const b = blocks[i] as { type?: string };
		if (b.type === "thinking" || b.type === "redacted_thinking") continue;
		blocks[i] = { ...blocks[i], cache_control: { type: "ephemeral" } } as Anthropic.Beta.BetaContentBlockParam;
		return;
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
