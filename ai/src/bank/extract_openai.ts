// Извлечение документа моделью OpenAI или OpenAI-совместимым сервером (в том числе локальным: vLLM,
// llama.cpp, Ollama — через OPENAI_BASE_URL). Контракт тот же, что у BankExtractor (Claude): код достаёт
// текст файла, модель отвечает JSON по EXTRACT_SCHEMA, zod на выходе.
//
// Файл целиком (PDF без текстового слоя) передаётся частью сообщения type=file — это умеет OpenAI; локальные
// серверы обычно нет, и для них скан без текста пока не читается.
//
// strict: false — строгий режим OpenAI требует перечислить в required каждое поле, а у документа большая
// часть полей необязательна. Схему модель всё равно получает и следует ей; проверку делает zod.

import OpenAI from "openai";
import { noteLlmError, noteLlmSuccess } from "../llm/health.ts";
import { isReasoningModel, type ChatClient } from "../llm/openai.ts";
import { ExtractError, SYSTEM, EXTRACT_SCHEMA, parseExtraction, parseJsonAnswer, prepareInput, userText, type ExtractResult, type StatementExtractor } from "./extract.ts";
import type { ContentReader } from "../extract/index.ts";

export type OpenAIExtractOptions = {
	apiKey: string; model: string; baseURL?: string; timeoutMs?: number; client?: ChatClient;
	readContent?: ContentReader | null;
	mode?: "auto" | "file";
};

export class OpenAIBankExtractor implements StatementExtractor {
	private readonly client: ChatClient;
	private readonly model: string;
	private readonly readContent: ContentReader | null;
	private readonly mode: "auto" | "file";

	constructor(opts: OpenAIExtractOptions) {
		this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL || undefined, timeout: opts.timeoutMs ?? 600_000, maxRetries: 2 });
		this.model = opts.model;
		this.readContent = opts.readContent ?? null;
		this.mode = opts.mode ?? "auto";
	}

	async extract(file: Buffer, fileName: string): Promise<ExtractResult> {
		const prep = await prepareInput(file, fileName, this.readContent, this.mode);
		const content: OpenAI.Chat.ChatCompletionContentPart[] = prep.input === "file"
			? [{ type: "file", file: { filename: fileName, file_data: `data:application/pdf;base64,${prep.pdf.toString("base64")}` } }]
			: [];
		content.push({ type: "text", text: userText(prep, fileName) });
		let response: OpenAI.Chat.ChatCompletion;
		try {
			response = await this.client.chat.completions.create({
				model: this.model,
				messages: [{ role: "system", content: SYSTEM }, { role: "user", content }],
				response_format: { type: "json_schema", json_schema: { name: "document", schema: EXTRACT_SCHEMA, strict: false } },
				max_completion_tokens: 32_000,
				...(isReasoningModel(this.model) ? { reasoning_effort: "high" as const } : {}),
			});
		} catch (e) {
			noteLlmError(e instanceof OpenAI.AuthenticationError ? "LLM_AUTH" : "LLM_ERROR", e instanceof Error ? e.message : String(e));
			if (e instanceof OpenAI.APIError) throw new ExtractError("LLM_ERROR", `Ошибка модели при чтении файла (${e.status ?? "?"}): ${e.message}`);
			throw new ExtractError("LLM_ERROR", e instanceof Error ? e.message : String(e));
		}
		noteLlmSuccess();

		const choice = response.choices[0];
		if (choice?.finish_reason === "length") throw new ExtractError("TRUNCATED", "Документ слишком длинный для одного прохода — разделите файл");
		const text = choice?.message.content ?? "";
		if (!text.trim()) throw new ExtractError("NO_STATEMENT", `Модель не распознала документ в «${fileName}» (finish: ${choice?.finish_reason ?? "?"})`);
		return parseExtraction(parseJsonAnswer(text, fileName), fileName, {
			sha256: prep.sha256, model: response.model, input: prep.input,
			usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 },
		});
	}
}
