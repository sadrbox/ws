// Здоровье LLM-провайдера для панели статуса: последняя ошибка и последний успех.
//
// Пользователь в чате видит «Не удалось обратиться к модели» и не понимает, что делать.
// Панель статуса должна отвечать на это: исчерпан баланс, неверный ключ, лимит запросов или
// сеть. Состояние хранится в памяти процесса — этого достаточно: после перезапуска оно
// восстановится первым же запросом к модели.

export type LlmHealth = {
	ok: boolean;
	lastSuccessAt: string | null;
	lastError: { code: string; message: string; hint: string; at: string } | null;
};

const state: { lastSuccessAt: Date | null; lastError: { code: string; message: string; at: Date } | null } = { lastSuccessAt: null, lastError: null };

export function noteLlmSuccess(): void {
	state.lastSuccessAt = new Date();
	state.lastError = null;
}

export function noteLlmError(code: string, message: string): void {
	state.lastError = { code, message, at: new Date() };
}

/** Что делать пользователю/администратору — по коду и тексту ошибки провайдера. */
export function llmHint(code: string, message: string): string {
	const m = message.toLowerCase();
	if (m.includes("credit balance") || m.includes("billing")) return "Исчерпан баланс Anthropic API — нужно пополнить счёт (Plans & Billing)";
	if (code === "LLM_AUTH") return "Неверный или отозванный ключ Anthropic API";
	if (code === "LLM_RATE_LIMIT") return "Превышен лимит запросов к модели — повторите через минуту";
	if (code === "LLM_UNAVAILABLE") return "Сервис модели недоступен (сеть или сбой провайдера)";
	return "Ошибка модели — подробности в журнале AI-сервиса";
}

export function llmHealth(): LlmHealth {
	return {
		ok: state.lastError === null,
		lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
		lastError: state.lastError
			? { code: state.lastError.code, message: state.lastError.message.slice(0, 300), hint: llmHint(state.lastError.code, state.lastError.message), at: state.lastError.at.toISOString() }
			: null,
	};
}
