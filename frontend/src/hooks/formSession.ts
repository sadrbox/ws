// Session-персистентность форм: per-tab токен сессии + persist/restore/clear
// снапшотов в localStorage. Вынесено из useFormStore.ts (Q9).
import type { FormStoreState, TableState } from "./formStore.types";

const SESSION_TOKEN_KEY = "_st";
const TAB_ID_STORAGE_KEY = "formStore:tabId";
const CURRENT_SESSION_TOKEN = (() => {
	try {
		const existing = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
		if (existing) return existing;
		const fresh = Math.random().toString(36).slice(2) + Date.now().toString(36);
		sessionStorage.setItem(TAB_ID_STORAGE_KEY, fresh);
		return fresh;
	} catch {
		// sessionStorage недоступен (приватный режим и т.п.) — fallback: in-memory.
		return Math.random().toString(36).slice(2) + Date.now().toString(36);
	}
})();

export function persistToSession<F extends object>(
	storageKey: string,
	state: FormStoreState<F>,
): void {
	try {
		// Сохраняем fields + tables + токен текущей сессии
		const payload = {
			fields: state.fields,
			tables: state.tables,
			[SESSION_TOKEN_KEY]: CURRENT_SESSION_TOKEN,
		};
		localStorage.setItem(storageKey, JSON.stringify(payload));
	} catch {
		/* quota exceeded */
	}
}

export function restoreFromSession<F extends object>(
	storageKey: string,
): {
	fields: F;
	tables: Record<string, TableState>;
	fromCurrentSession: boolean;
} | null {
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as {
			fields: F;
			tables: Record<string, TableState>;
			[SESSION_TOKEN_KEY]?: string;
		};
		const fromCurrentSession =
			parsed[SESSION_TOKEN_KEY] === CURRENT_SESSION_TOKEN;
		return { fields: parsed.fields, tables: parsed.tables, fromCurrentSession };
	} catch {
		return null;
	}
}

export function clearSession(storageKey: string): void {
	try {
		localStorage.removeItem(storageKey);
	} catch {
		/* ignore */
	}
}
