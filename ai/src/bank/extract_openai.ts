// Извлечение выписки из PDF моделью OpenAI — тот же контракт, что у BankExtractor (Claude):
// документ на входе, принудительный вызов record_statement, схема = модель выписки, zod на выходе.
//
// PDF передаётся частью сообщения type=file (base64 data URL): модель получает и текст, и
// изображение страниц — как и у Claude, таблицы с переносами строк читаются целиком.

import OpenAI from "openai";
import { createHash } from "node:crypto";
import { noteLlmError, noteLlmSuccess } from "../llm/health.ts";
import { isReasoningModel, parseArguments, type ChatClient } from "../llm/openai.ts";
import { ExtractError, SYSTEM, normalize, type Extracted, type StatementExtractor } from "./extract.ts";
import { StatementSchema, STATEMENT_JSON_SCHEMA, reconcile } from "./schema.ts";

export type OpenAIExtractOptions = { apiKey: string; model: string; baseURL?: string; timeoutMs?: number; client?: ChatClient };

export class OpenAIBankExtractor implements StatementExtractor {
	private readonly client: ChatClient;
	private readonly model: string;

	constructor(opts: OpenAIExtractOptions) {
		this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL || undefined, timeout: opts.timeoutMs ?? 600_000, maxRetries: 2 });
		this.model = opts.model;
	}

	async extract(pdf: Buffer, fileName: string): Promise<Extracted> {
		if (!pdf.length) throw new ExtractError("EMPTY_FILE", "Пустой файл");
		if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ExtractError("NOT_PDF", `«${fileName}» не является PDF`);
		if (pdf.length > 30 * 1024 * 1024) throw new ExtractError("TOO_LARGE", "PDF больше 30 МБ");

		const sha256 = createHash("sha256").update(pdf).digest("hex");
		let response: OpenAI.Chat.ChatCompletion;
		try {
			response = await this.client.chat.completions.create({
				model: this.model,
				messages: [
					{ role: "system", content: SYSTEM },
					{
						role: "user",
						content: [
							{ type: "file", file: { filename: fileName, file_data: `data:application/pdf;base64,${pdf.toString("base64")}` } },
							{ type: "text", text: `Извлеки выписку из файла «${fileName}» и передай в record_statement.` },
						],
					},
				],
				tools: [{ type: "function", function: { name: "record_statement", description: "Зафиксировать распознанную выписку", parameters: STATEMENT_JSON_SCHEMA } }],
				tool_choice: { type: "function", function: { name: "record_statement" } },
				max_completion_tokens: 32_000,
				...(isReasoningModel(this.model) ? { reasoning_effort: "high" as const } : {}),
			});
		} catch (e) {
			noteLlmError(e instanceof OpenAI.AuthenticationError ? "LLM_AUTH" : "LLM_ERROR", e instanceof Error ? e.message : String(e));
			if (e instanceof OpenAI.APIError) throw new ExtractError("LLM_ERROR", `Ошибка модели при чтении PDF (${e.status ?? "?"}): ${e.message}`);
			throw new ExtractError("LLM_ERROR", e instanceof Error ? e.message : String(e));
		}
		noteLlmSuccess();

		const choice = response.choices[0];
		const call = (choice?.message.tool_calls ?? []).find((c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === "function" && c.function.name === "record_statement");
		if (!call) throw new ExtractError("NO_STATEMENT", `Модель не распознала выписку в «${fileName}» (finish: ${choice?.finish_reason ?? "?"})`);
		if (choice.finish_reason === "length") throw new ExtractError("TRUNCATED", "Выписка слишком длинная для одного прохода — разделите PDF");

		const parsed = StatementSchema.safeParse(normalize(parseArguments(call.function.arguments)));
		if (!parsed.success) {
			const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
			throw new ExtractError("BAD_STATEMENT", `Распознанные данные не прошли проверку: ${issues}`);
		}
		const statement = parsed.data;
		return {
			statement, reconciliation: reconcile(statement), sha256, model: response.model,
			usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 },
		};
	}
}
