// История диалога для модели: целостная и в пределах окна (И28, И29 аудита 26.09).
//
// Чистые функции — без базы и без модели: их легко проверить на любых «битых» историях, какие только
// накопились в таблице `messages` за время, пока ходы одного диалога могли идти вперемешку.

import type { ChatMessage, ToolResult } from "../llm/provider.ts";

/**
 * Сколько символов истории (JSON сообщений) уходит модели. ~300 тыс. символов — порядка 80–100 тыс. токенов:
 * хватает на длинный рабочий разговор с выписками, а каждый раунд (до 8 за ход) не везёт с собой всю историю
 * месяца. Настраивается CHAT_HISTORY_MAX_CHARS.
 */
export const HISTORY_MAX_CHARS = 300_000;

/** Доля окна под прошлые ходы: остальное — запас на текущий ход, который растёт от раунда к раунду. */
const PRIOR_SHARE = 0.75;

export const TRIMMED_NOTE = "[Начало диалога опущено: история слишком длинная. Если нужны прежние данные — запроси их заново.]\n";

const interrupted = (toolCallId: string): ToolResult => ({
	toolCallId, content: { error: "INTERRUPTED", message: "ход был прерван, результат не получен" }, isError: true,
});

/**
 * ЦЕЛОСТНОСТЬ ИСТОРИИ (И28). API модели требует: сразу за ответом с вызовами инструментов — ОДНО сообщение
 * пользователя с результатом на КАЖДЫЙ вызов, и никаких результатов без вызова. Прежняя починка только
 * досыпала недостающие результаты; когда фоновый ход и новое сообщение писали в историю вперемешку, в ней
 * оставались «осиротевшие» результаты — они ссылались на вызов из более раннего ответа, и модель отвечала 400
 * на каждый следующий ход: диалог ломался навсегда.
 *
 * Правило сборки: за ответом с вызовами собираются результаты ИМЕННО его вызовов из идущих следом сообщений с
 * результатами (в одном сообщении, в порядке вызовов, без повторов); недостающие — «ход прерван»; результаты
 * без своего вызова выбрасываются. Пустые сообщения (без текста, вызовов и сырого ответа) — тоже: API их не
 * принимает.
 */
export function repairHistory(raw: readonly ChatMessage[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	let i = 0;
	while (i < raw.length) {
		const m = raw[i]!;
		if (m.role === "assistant") {
			i++;
			const calls = m.toolCalls ?? [];
			const rawBlocks = Array.isArray(m.raw) ? m.raw.length : 0;
			if (!calls.length && !m.text && !rawBlocks) continue;
			out.push(m);
			if (!calls.length) continue;
			const ids = new Set(calls.map((c) => c.id));
			const got = new Map<string, ToolResult>();
			while (i < raw.length && raw[i]!.role === "user" && "toolResults" in raw[i]!) {
				for (const r of (raw[i] as { toolResults: ToolResult[] }).toolResults) {
					if (ids.has(r.toolCallId) && !got.has(r.toolCallId)) got.set(r.toolCallId, r);
				}
				i++;
			}
			out.push({ role: "user", toolResults: calls.map((c) => got.get(c.id) ?? interrupted(c.id)) });
			continue;
		}
		i++;
		// Результаты без вызова прямо перед ними — осиротевшие: их вызов уже закрыт (или его нет вовсе).
		if ("toolResults" in m) continue;
		if (!m.text) continue;
		out.push(m);
	}
	// Первое сообщение — пользователя: ответ модели в начале истории API не принимает.
	while (out.length && out[0]!.role !== "user") out.shift();
	while (out.length && "toolResults" in out[0]!) out.shift();
	return out;
}

const sizeOf = (m: ChatMessage): number => {
	if (m.role === "assistant") return JSON.stringify(Array.isArray(m.raw) && m.raw.length ? m.raw : { t: m.text, c: m.toolCalls }).length;
	return JSON.stringify(m).length;
};

/** Начало хода — сообщение пользователя с текстом (не результаты инструментов). */
const isTurnStart = (m: ChatMessage): boolean => m.role === "user" && "text" in m;

/** Блоки рассуждений модели: их можно убирать только ведущим участком, от старых к новым. */
const isThinking = (b: unknown): boolean => {
	const t = (b as { type?: unknown } | null)?.type;
	return t === "thinking" || t === "redacted_thinking";
};

/**
 * ОКНО ИСТОРИИ (И29). Раньше модели каждый раунд (до 8 за ход) уходила вся история диалога: стоимость росла как
 * история × раунды, а длинный диалог упирался в предел контекста — 400 и сломанный диалог.
 *
 * Окно режется только по НАЧАЛУ ХОДА (сообщение пользователя с текстом): пары «вызов — результат» не разрываются.
 * Решение считается по прошлым ходам и потому одинаково во всех раундах текущего хода: начало истории не
 * «плывёт» от раунда к раунду, и кэш промпта внутри хода работает. В оставшихся прошлых ходах убираются блоки
 * рассуждений — это ведущий участок, его API разрешает снимать; рассуждения текущего хода не трогаются.
 */
export function windowHistory(msgs: readonly ChatMessage[], maxChars = HISTORY_MAX_CHARS): { messages: ChatMessage[]; dropped: number } {
	const total = msgs.reduce((n, m) => n + sizeOf(m), 0);
	if (total <= maxChars || msgs.length < 2) return { messages: [...msgs], dropped: 0 };
	let current = -1;
	for (let i = msgs.length - 1; i >= 0; i--) if (isTurnStart(msgs[i]!)) { current = i; break; }
	if (current <= 0) return { messages: [...msgs], dropped: 0 };

	const budget = Math.floor(maxChars * PRIOR_SHARE);
	let start = current;
	let prior = 0;
	for (let i = current - 1; i >= 0; i--) {
		prior += sizeOf(msgs[i]!);
		if (prior > budget) break;
		if (isTurnStart(msgs[i]!)) start = i;
	}
	if (start === 0) return { messages: [...msgs], dropped: 0 };

	const kept = msgs.slice(start).map((m, k): ChatMessage | null => {
		const idx = start + k;
		if (idx < current && m.role === "assistant" && Array.isArray(m.raw) && m.raw.some(isThinking)) {
			const rest = m.raw.filter((b) => !isThinking(b));
			// Ответ из одних рассуждений: без них в нём ничего нет, а пустой ответ API не принимает.
			if (!rest.length && !m.text && !m.toolCalls.length) return null;
			return { ...m, raw: rest.length ? rest : undefined };
		}
		return m;
	}).filter((m): m is ChatMessage => m !== null);
	const first = kept[0]!;
	if (first.role === "user" && "text" in first) kept[0] = { role: "user", text: TRIMMED_NOTE + first.text };
	return { messages: kept, dropped: start };
}
