// Извлечение выписки из PDF — Claude с документом на входе и принудительным вызовом
// инструмента, схема которого и есть модель выписки.
//
// Почему инструмент, а не «верни JSON текстом»: tool_use гарантирует структуру (модель не
// может ответить прозой или обернуть JSON в markdown), а схема с описаниями полей — это
// одновременно и инструкция модели, и валидация на выходе (zod по той же модели).
//
// Модель здесь ТОЛЬКО читает документ. Она не решает, что делать со строками, не подбирает
// контрагентов и не создаёт ничего — всё это дальше делает 1С по своим правилам (§9 ТЗ).

import Anthropic from "@anthropic-ai/sdk";
import { noteLlmError, noteLlmSuccess } from "../llm/health.ts";
import { createHash } from "node:crypto";
import { StatementSchema, STATEMENT_JSON_SCHEMA, reconcile, type Statement, type Reconciliation } from "./schema.ts";

export type ExtractOptions = { apiKey: string; model: string; timeoutMs?: number };

export type Extracted = { statement: Statement; reconciliation: Reconciliation; sha256: string; usage: { inputTokens: number; outputTokens: number }; model: string };

export class ExtractError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

const SYSTEM = `Ты извлекаешь данные из банковской выписки (Казахстан) в структуру record_statement. Правила:
- Перенеси ВСЕ операции из документа, по порядку, ничего не пропуская и не объединяя. Итоговые строки («Итого», «Обороты», остатки) в lines не включай — их значения идут в totalIn/totalOut/openingBalance/closingBalance.
- Направление считай относительно владельца счёта: зачисление на его счёт — in (кредит), списание с его счёта — out (дебет). Комиссии банка — out с контрагентом «банк».
- counterparty — вторая сторона операции: для in это плательщик, для out — получатель. Если у операции вторая сторона — сам владелец (перевод между своими счетами), укажи его данные.
- Суммы — числами без разделителей тысяч, точка как десятичный разделитель. Даты — YYYY-MM-DD. БИН/ИИН — ровно 12 цифр, иначе оставь пустым. КНП — 3 цифры.
- Ничего не придумывай: если реквизит не напечатан — оставь поле пустым или null. Не исправляй и не «улучшай» текст назначения платежа.
- Если в документе несколько счетов или валют, извлеки счёт в тенге (KZT); при нескольких счетах в KZT — первый.`;

export class BankExtractor {
	private readonly client: Anthropic;
	private readonly model: string;

	constructor(opts: ExtractOptions) {
		this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 600_000, maxRetries: 2 });
		this.model = opts.model;
	}

	async extract(pdf: Buffer, fileName: string): Promise<Extracted> {
		if (!pdf.length) throw new ExtractError("EMPTY_FILE", "Пустой файл");
		if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ExtractError("NOT_PDF", `«${fileName}» не является PDF`);
		if (pdf.length > 30 * 1024 * 1024) throw new ExtractError("TOO_LARGE", "PDF больше 30 МБ");

		const sha256 = createHash("sha256").update(pdf).digest("hex");
		let response: Anthropic.Beta.BetaMessage;
		try {
			response = await this.client.beta.messages.create({
				model: this.model,
				max_tokens: 64_000,
				system: SYSTEM,
				tools: [{ name: "record_statement", description: "Зафиксировать распознанную выписку", input_schema: STATEMENT_JSON_SCHEMA as Anthropic.Beta.BetaTool.InputSchema }],
				tool_choice: { type: "tool", name: "record_statement" },
				thinking: { type: "adaptive" },
				output_config: { effort: "high" },
				messages: [{
					role: "user",
					content: [
						{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") }, title: fileName },
						{ type: "text", text: `Извлеки выписку из файла «${fileName}» и передай в record_statement.` },
					],
				}],
			} as Anthropic.Beta.MessageCreateParamsNonStreaming);
		} catch (e) {
			noteLlmError(e instanceof Anthropic.AuthenticationError ? "LLM_AUTH" : "LLM_ERROR", e instanceof Error ? e.message : String(e));
			if (e instanceof Anthropic.APIError) throw new ExtractError("LLM_ERROR", `Ошибка модели при чтении PDF (${e.status ?? "?"}): ${e.message}`);
			throw new ExtractError("LLM_ERROR", e instanceof Error ? e.message : String(e));
		}
		noteLlmSuccess();

		const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "record_statement");
		if (!call) throw new ExtractError("NO_STATEMENT", `Модель не распознала выписку в «${fileName}» (stop: ${response.stop_reason})`);
		if (response.stop_reason === "max_tokens") throw new ExtractError("TRUNCATED", "Выписка слишком длинная для одного прохода — разделите PDF");

		const parsed = StatementSchema.safeParse(normalize(call.input));
		if (!parsed.success) {
			const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
			throw new ExtractError("BAD_STATEMENT", `Распознанные данные не прошли проверку: ${issues}`);
		}
		const statement = parsed.data;
		return { statement, reconciliation: reconcile(statement), sha256, model: response.model, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
	}
}

/** Мелкая нормализация ответа модели до валидации: пустые строки → undefined, БИН без пробелов. */
function normalize(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(normalize);
	if (v && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			if (val === "" || val === null && k !== "openingBalance" && k !== "closingBalance" && k !== "totalIn" && k !== "totalOut") continue;
			if (k === "bin" && typeof val === "string") { out[k] = val.replace(/\D/g, ""); continue; }
			if (k === "iik" && typeof val === "string") { out[k] = val.replace(/\s/g, ""); continue; }
			if (k === "knp" && typeof val === "string") { out[k] = val.replace(/\D/g, "").slice(0, 3); continue; }
			out[k] = normalize(val);
		}
		return out;
	}
	return v;
}
