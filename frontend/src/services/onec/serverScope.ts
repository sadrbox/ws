/**
 * Выбранный сервер 1С панели (C9, несколько серверов).
 *
 * Имя базы уникально только в пределах сервера, и сервис адресует базу парой «сервер + ключ». Выбор хранится здесь
 * и уходит заголовком `X-Onec-Server` в каждом запросе `/v1/onec/*` (aiFetch) — поэтому ни один вызов API не нужно
 * переписывать. Пусто — «все серверы»: списки сводные, одноимённую базу сервис попросит уточнить (409).
 *
 * Выбор — удобство одного зрителя: хранится в localStorage и переживает перезагрузку.
 */
const KEY = "onec.server";
let current: string | null = null;
const listeners = new Set<(id: string | null) => void>();

try {
	current = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
} catch {
	current = null;
}

export const getOnecServer = (): string | null => current;

export function setOnecServer(id: string | null): void {
	if (id === current) return;
	current = id;
	try {
		if (id) localStorage.setItem(KEY, id);
		else localStorage.removeItem(KEY);
	} catch {
		/* приватный режим — выбор живёт до перезагрузки */
	}
	for (const l of listeners) l(id);
}

export function subscribeOnecServer(l: (id: string | null) => void): () => void {
	listeners.add(l);
	return () => { listeners.delete(l); };
}
