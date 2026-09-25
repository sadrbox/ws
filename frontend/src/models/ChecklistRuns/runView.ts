/**
 * Чек-листы самопроверки (E17 СК3) — чистые помощники экранов: подписи состояний, прогресс,
 * период по умолчанию для нового чек-листа.
 */
import { translate } from "src/i18";
import type { QualityTone } from "src/models/_quality/QualityChip";
import type { ChecklistItemStatus, ChecklistRun, ChecklistRunItem } from "src/services/quality/api";
import { getFormatDateOnly } from "src/utils/datetime";

export type RunStatus = ChecklistRun["status"];

const RUN_STATUS_KEYS: Record<RunStatus, string> = {
	open: "checklistRunStatusOpen",
	submitted: "checklistRunStatusSubmitted",
	reviewed: "checklistRunStatusReviewed",
};

const ITEM_STATUS_KEYS: Record<ChecklistItemStatus, string> = {
	pending: "checklistItemPending",
	ok: "checklistItemOk",
	na: "checklistItemNa",
	problem: "checklistItemProblem",
};

/** Отметки, которые ставит исполнитель (кнопки пункта). «Не отмечен» — только состояние. */
export const MARKS: readonly Exclude<ChecklistItemStatus, "pending">[] = ["ok", "na", "problem"];

export const runStatusLabel = (s: string): string =>
	RUN_STATUS_KEYS[s as RunStatus] ? translate(RUN_STATUS_KEYS[s as RunStatus]) : s;

export const itemStatusLabel = (s: string): string =>
	ITEM_STATUS_KEYS[s as ChecklistItemStatus] ? translate(ITEM_STATUS_KEYS[s as ChecklistItemStatus]) : s;

/** Открыт — ждёт исполнителя, сдан — ждёт главбуха, подписан — готово. */
export function runStatusTone(s: string): QualityTone {
	if (s === "reviewed") return "ok";
	if (s === "submitted") return "info";
	if (s === "open") return "warn";
	return "muted";
}

export function itemStatusTone(s: string): QualityTone {
	if (s === "ok") return "ok";
	if (s === "problem") return "bad";
	if (s === "na") return "muted";
	return "warn";
}

/** «7/12» и, если есть, «· проблем: 2». Пусто, если прогресса нет. */
export function progressText(p: ChecklistRun["progress"] | null | undefined): string {
	if (!p || !p.total) return "";
	const base = `${p.done}/${p.total}`;
	return p.problems ? `${base} · ${translate("checklistRunProblems")}: ${p.problems}` : base;
}

/** Сколько пунктов ещё не отмечено: сдать главбуху можно только при нуле. */
export const pendingCount = (items: readonly Pick<ChecklistRunItem, "status">[] | null | undefined): number =>
	(items ?? []).filter((i) => i.status === "pending").length;

/** Период «с — по» для показа. */
export function periodText(from: string | null | undefined, to: string | null | undefined): string {
	const a = getFormatDateOnly(from);
	const b = getFormatDateOnly(to);
	return a && b ? `${a} — ${b}` : a || b;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;
/** Последний день месяца (m — 1…12). */
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Период нового чек-листа по периодичности шаблона: ПРОШЕДШИЙ месяц, квартал или год —
 * самопроверку проходят по закрытому периоду, перед отчётностью. Разовый — текущий месяц.
 * Человек может поправить даты в окне создания.
 * @param today «ГГГГ-ММ-ДД» по времени приложения.
 */
export function defaultPeriod(periodicity: string, today: string): { from: string; to: string } {
	const [y, m] = today.split("-").map(Number);
	if (periodicity === "year") return { from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) };
	if (periodicity === "quarter") {
		const q = Math.floor((m - 1) / 3); // текущий квартал 0…3
		const py = q === 0 ? y - 1 : y;
		const pq = q === 0 ? 3 : q - 1;
		const first = pq * 3 + 1;
		return { from: ymd(py, first, 1), to: ymd(py, first + 2, lastDay(py, first + 2)) };
	}
	if (periodicity === "once") return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) };
	const py = m === 1 ? y - 1 : y;
	const pm = m === 1 ? 12 : m - 1;
	return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDay(py, pm)) };
}
