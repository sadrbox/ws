// Абстракция LLM (§3 ТЗ): диалог с инструментами, независимый от конкретной модели.
//
// Типы здесь нейтральны к провайдеру намеренно: Ollama, llama.cpp и OpenAI-совместимые
// API описывают tool use по-разному, а сервис должен переключаться между ними конфигом,
// не трогая ни workflow, ни tools. Провайдер переводит эти типы в свой формат и обратно.
//
// Провайдер НЕ исполняет инструменты и НЕ крутит цикл. Один вызов chat() — один ход модели:
// либо текст (вопрос пользователю / итог), либо запрос инструментов. Цикл ведёт chat/workflow,
// потому что между ходами он может остановиться на подтверждении пользователя (§17) и
// продолжить через час из другого HTTP-запроса — с состоянием из базы, а не из памяти.

export type ToolDefinition = {
	name: string;
	description: string;
	/** JSON Schema входа. */
	inputSchema: Record<string, unknown>;
};

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ToolResult = {
	toolCallId: string;
	/** Сериализуемый результат — уходит модели как текст JSON. */
	content: unknown;
	isError?: boolean;
};

/** Сообщение истории. Блоки инструментов хранятся как есть, чтобы ход можно было воспроизвести. */
export type ChatMessage =
	| { role: "user"; text: string }
	| { role: "user"; toolResults: ToolResult[] }
	| { role: "assistant"; text: string; toolCalls: ToolCall[]; raw?: unknown };

export type LLMRequest = {
	system: string;
	messages: ChatMessage[];
	tools: ToolDefinition[];
	/** Признак, что промпт и tools стабильны — провайдер может кэшировать. */
	cacheable?: boolean;
	maxTokens?: number;
};

export type LLMResponse = {
	text: string;
	toolCalls: ToolCall[];
	/** Почему модель остановилась: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | иное. */
	stopReason: string;
	/** Сырые блоки ответа провайдера — для точного воспроизведения истории на следующем ходе. */
	raw?: unknown;
	usage?: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number };
	model: string;
};

export interface LLMProvider {
	readonly name: string;
	chat(request: LLMRequest): Promise<LLMResponse>;
}

export class LLMError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	constructor(code: string, message: string, retryable = false) {
		super(message);
		this.code = code;
		this.retryable = retryable;
	}
}
