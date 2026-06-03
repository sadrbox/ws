/**
 * paneRestore — сериализация открытых панелей и их восстановление после
 * перезагрузки страницы.
 *
 * Панель содержит «живой» React-компонент, который нельзя сохранить. Поэтому
 * при открытии панели через реестры (openListByRef / openFormByEndpoint /
 * openReport) к ней прикрепляется сериализуемый «рецепт» восстановления
 * (TPaneRestore). При перезагрузке рецепты считываются из localStorage и
 * проигрываются заново — панели пересоздаются, а последняя активная вкладка
 * снова делается активной.
 *
 * Не восстанавливаются: selector-панели (диалоги выбора — временные) и панели
 * без рецепта (открытые произвольным компонентом), а также формы новых
 * (несохранённых) записей.
 */
import type { TPane, TPaneRestore } from "./types";

const STORAGE_KEY = "ui.panes.session";

export interface PersistedPane {
	uniqId: string;
	label: string;
	restore: TPaneRestore;
}

export interface PersistedSession {
	panes: PersistedPane[];
	activePaneId: string;
}

type AddPane = (options: Partial<TPane>) => void;

/** Считывает сохранённую сессию панелей (или null). */
export function loadPersistedSession(): PersistedSession | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const s = JSON.parse(raw) as PersistedSession;
		if (s && Array.isArray(s.panes)) return s;
	} catch {
		/* повреждённое значение — игнорируем */
	}
	return null;
}

/** Сохраняет текущие восстановимые панели + id активной вкладки. */
export function savePersistedSession(panes: TPane[], activePaneId: string): void {
	try {
		const items: PersistedPane[] = panes
			.filter((p) => !p.isSelector && p.restore)
			.map((p) => ({ uniqId: p.uniqId, label: p.label, restore: p.restore as TPaneRestore }));
		const session: PersistedSession = { panes: items, activePaneId };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
	} catch {
		/* квота / приватный режим — игнорируем */
	}
}

/** Проигрывает один рецепт восстановления панели через соответствующий реестр. */
export async function restorePane(p: PersistedPane, addPane: AddPane): Promise<void> {
	const r = p.restore;
	switch (r.kind) {
		case "list": {
			const { openListByRef } = await import("src/registry/formRegistry");
			await openListByRef(r.ref, addPane, p.label);
			return;
		}
		case "form": {
			if (!r.uuid) return; // новые/несохранённые формы не восстанавливаем
			const { openFormByEndpoint } = await import("src/registry/formRegistry");
			await openFormByEndpoint(r.endpoint, r.uuid, addPane);
			return;
		}
		case "report": {
			const { openReport } = await import("src/utils/openReport");
			await openReport(r.key, addPane, p.label, r.data);
			return;
		}
	}
}
