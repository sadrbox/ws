/**
 * Доска задач — чистые правила без JSX (Fast Refresh: index.tsx отдаёт только компоненты).
 *
 *   • колонки: статусы справочника + колонка на каждый код ВНЕ справочника. Раньше задачи с таким
 *     статусом (удалённый статус, статус из 1С, справочник ещё не загружен) раскладывались в
 *     группу, но колонка для неё не рисовалась — и задачи пропадали с доски без следа;
 *   • значки карточки (E17): вид задачи, просроченная реакция на обращение, напоминания клиента,
 *     просьба о помощи;
 *   • проверка переноса в финальную колонку и в колонку ожидания — те же правила, что у формы и
 *     сервера (todoRules.transitionError): без результата задачу не закрыть, без даты контроля —
 *     не поставить в ожидание.
 */
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import { kindLabel, reactionOverdue, transitionError, type StatusLike } from "src/models/Todos/todoRules";

export interface BoardColumn {
	code: string;
	label: string;
	/** Статус есть в справочнике. Колонка неизвестного кода — только показать задачи: бросать в неё нельзя. */
	known: boolean;
	isFinal: boolean;
	isWaiting: boolean;
}

/** Колонки доски: справочник по порядку, затем коды задач, которых в справочнике нет (в порядке появления). */
export function boardColumns(
	statuses: readonly (StatusLike & { name: string })[],
	todos: readonly { status?: unknown }[],
): BoardColumn[] {
	const cols: BoardColumn[] = statuses.map((s) => ({
		code: s.code, label: s.name, known: true, isFinal: !!s.isFinal, isWaiting: !!s.isWaiting,
	}));
	const seen = new Set(cols.map((c) => c.code));
	for (const t of todos) {
		const code = asText(t.status);
		if (seen.has(code)) continue;
		seen.add(code);
		cols.push({
			code,
			// «Код · нет в справочнике»: человек видит, откуда колонка, и может перетащить задачи в настоящую.
			label: code ? `${code} · ${translate("taskStatusUnknown")}` : translate("taskStatusEmpty"),
			known: false, isFinal: false, isWaiting: false,
		});
	}
	return cols;
}

/** Разложить задачи по колонкам. Каждая задача попадает ровно в одну колонку — см. boardColumns. */
export function groupByColumn<T extends { status?: unknown }>(todos: readonly T[], columns: readonly BoardColumn[]): Record<string, T[]> {
	const map: Record<string, T[]> = {};
	for (const c of columns) map[c.code] = [];
	for (const t of todos) (map[asText(t.status)] ??= []).push(t);
	return map;
}

// ── Значки карточки ───────────────────────────────────────────────────────────

export type BadgeTone = "info" | "danger" | "warning" | "accent";

export interface CardBadge {
	id: "kind" | "sla" | "reminders" | "help";
	label: string;
	title: string;
	tone: BadgeTone;
}

/** Виды, которые помечаются на карточке; обычная задача и регламентная — без значка (их большинство). */
const KIND_BADGES: Record<string, { key: string; tone: BadgeTone }> = {
	client_request: { key: "taskBadgeClientRequest", tone: "info" },
	error: { key: "taskBadgeError", tone: "danger" },
	manager_order: { key: "taskBadgeManagerOrder", tone: "accent" },
	check_finding: { key: "taskBadgeCheckFinding", tone: "warning" },
};

export interface BadgeSource {
	status?: unknown;
	kind?: unknown;
	acceptedAt?: unknown;
	reactionDueAt?: unknown;
	reminderCount?: unknown;
	helpRequestedAt?: unknown;
}

export function cardBadges(t: BadgeSource, finalCodes: ReadonlySet<string>, now: number = Date.now()): CardBadge[] {
	const out: CardBadge[] = [];
	const kind = asText(t.kind);
	const kb = KIND_BADGES[kind];
	if (kb) out.push({ id: "kind", label: translate(kb.key), title: kindLabel(kind), tone: kb.tone });
	// Обращение не принято к сроку реакции — п. 3; закрытому это уже не важно.
	if (reactionOverdue(t, finalCodes, now)) {
		out.push({ id: "sla", label: translate("taskBadgeSla"), title: translate("todoReactionOverdue"), tone: "danger" });
	}
	const reminders = Number(t.reminderCount) || 0;
	if (reminders > 0) {
		out.push({ id: "reminders", label: translate("taskBadgeReminders").replace("{n}", String(reminders)), title: translate("todoReminderCount"), tone: "warning" });
	}
	if (asText(t.helpRequestedAt)) {
		out.push({ id: "help", label: translate("taskBadgeHelp"), title: translate("todoHelpRequestedAt"), tone: "accent" });
	}
	return out;
}

// ── Перенос карточки ──────────────────────────────────────────────────────────

/**
 * Почему задачу нельзя перенести в колонку (текст для человека) или null. Сервер проверяет то же
 * самое; здесь — чтобы не отправлять заведомый отказ и не дёргать карточку туда и обратно.
 */
export function moveError(
	t: { result?: unknown; nextControlAt?: unknown },
	target: string,
	statuses: readonly StatusLike[],
): string | null {
	return transitionError({ nextStatus: target, statuses, result: t.result, nextControlAt: t.nextControlAt });
}

/** Заголовок карточки: описание, иначе название (у задач расписания описания может не быть). */
export const cardTitle = (t: { id?: unknown; description?: unknown; name?: unknown }): string =>
	(asText(t.description) || asText(t.name) || `#${asText(t.id)}`).trim();
