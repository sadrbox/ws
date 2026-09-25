/**
 * Пункты шаблона чек-листа (E17 СК3.1) — чистые помощники редактора: черновики строк,
 * перестановка, привязка к проверке учёта и сборка тела запроса.
 *
 * Сервер заменяет пункты шаблона ЦЕЛИКОМ (PUT с items[]), поэтому форма держит весь список в
 * своих полях и отправляет его при записи: порядок — по положению строки в редакторе.
 */
import { translate } from "src/i18";
import type { ChecklistPeriodicity, ChecklistTemplateItem } from "src/services/quality/api";
import { findCheck } from "src/services/quality/checkCatalog";

export const PERIODICITIES: readonly ChecklistPeriodicity[] = ["month", "quarter", "year", "once"];

const PERIODICITY_KEYS: Record<ChecklistPeriodicity, string> = {
	month: "checklistPeriodMonth",
	quarter: "checklistPeriodQuarter",
	year: "checklistPeriodYear",
	once: "checklistPeriodOnce",
};

export const periodicityLabel = (p: string): string =>
	PERIODICITY_KEYS[p as ChecklistPeriodicity] ? translate(PERIODICITY_KEYS[p as ChecklistPeriodicity]) : p;

/** Пунктов в стандарте — сорок (приложение А плана). */
export const STANDARD_ITEMS_COUNT = 40;

/** Строка редактора: всё строками, как в полях ввода; key — для React и перестановки. */
export interface TemplateItemDraft {
	key: string;
	text: string;
	checkCode: string;
	standardItemNumber: string;
}

let seq = 0;
/** Ключ новой строки (не uuid сервера: сервер при записи пересоздаёт пункты). */
export const newDraftKey = (): string => `new-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const emptyDraft = (): TemplateItemDraft => ({ key: newDraftKey(), text: "", checkCode: "", standardItemNumber: "" });

/** Пункты сервера → строки редактора, по порядку. */
export function toDrafts(items: readonly ChecklistTemplateItem[] | null | undefined): TemplateItemDraft[] {
	return [...(items ?? [])]
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
		.map((i) => ({
			key: i.uuid || newDraftKey(),
			text: i.text ?? "",
			checkCode: i.checkCode ?? "",
			standardItemNumber: i.standardItemNumber ? String(i.standardItemNumber) : "",
		}));
}

/** Сдвинуть строку на delta позиций (−1 вверх, +1 вниз); за край — без изменений. */
export function moveDraft<T>(list: readonly T[], index: number, delta: number): T[] {
	const to = index + delta;
	if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
	const next = [...list];
	const [item] = next.splice(index, 1);
	next.splice(to, 0, item);
	return next;
}

/**
 * Привязать строку к проверке. Пустой пункт стандарта подставляется из каталога (проверка
 * `stock.negative` — п. 12): так привязка сразу говорит, какое нарушение она сторожит.
 * Уже выбранный пункт не трогаем — его выбрал человек.
 */
export function withCheck(draft: TemplateItemDraft, checkCode: string): TemplateItemDraft {
	const next = { ...draft, checkCode };
	const item = findCheck(checkCode)?.item;
	if (!draft.standardItemNumber && item) next.standardItemNumber = String(item);
	return next;
}

export interface ItemPayload { position: number; text: string; checkCode: string | null; standardItemNumber: number | null }

export type ItemsResult =
	| { ok: true; items: ItemPayload[] }
	| { ok: false; error: "noText" | "badNumber"; row: number };

/**
 * Строки редактора → items[] для сервера. Совсем пустые строки отбрасываются молча; строка с
 * проверкой или пунктом, но без текста — ошибка (иначе сервер тихо её выбросит, а человек
 * решит, что привязка сохранилась). Номер пункта — целое 1…40.
 */
export function draftsToPayload(drafts: readonly TemplateItemDraft[]): ItemsResult {
	const items: ItemPayload[] = [];
	for (let i = 0; i < drafts.length; i++) {
		const d = drafts[i];
		const text = d.text.trim();
		const num = d.standardItemNumber.trim();
		if (!text) {
			if (d.checkCode || num) return { ok: false, error: "noText", row: i + 1 };
			continue;
		}
		let standardItemNumber: number | null = null;
		if (num) {
			const n = Number(num);
			if (!Number.isInteger(n) || n < 1 || n > STANDARD_ITEMS_COUNT) return { ok: false, error: "badNumber", row: i + 1 };
			standardItemNumber = n;
		}
		items.push({ position: items.length, text, checkCode: d.checkCode || null, standardItemNumber });
	}
	return { ok: true, items };
}

/** Текст ошибки сборки пунктов для <Notice /> формы. */
export function itemsErrorText(r: Extract<ItemsResult, { ok: false }>): string {
	const key = r.error === "noText" ? "checklistTplItemNoText" : "checklistTplItemBadNumber";
	return translate(key).replace("{n}", String(r.row));
}
