/**
 * Задачи E17 «Стандарт качества» (СК1) — правила и подписи на стороне панели.
 *
 * ТЕ ЖЕ ПРАВИЛА, ЧТО НА СЕРВЕРЕ (backend/services/quality/taskRules.js):
 *   • финальный статус, кроме отмены, — только с результатом («написала», «позвонила»,
 *     «передала», «не ответили» — не результат, п. 1 стандарта);
 *   • статус ожидания («Ждём клиента/контрагента») — только с датой следующего контроля.
 * Сервер проверяет сам и отвечает 400 с тем же смыслом. Здесь правило повторено, чтобы форма
 * показала <Notice /> ДО запроса, а доска не дёргала карточку туда и обратно. Меняется правило —
 * менять в обоих местах (тексты — по смыслу те же, но через словарь: RU/KK).
 *
 * Модуль без JSX: им пользуются форма, список и доска задач (Fast Refresh — компоненты отдельно).
 */
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import type { Priority, TodoEventRow, TodoKind, TodoWatcherRow } from "src/services/quality/api";

// ── Подписи кодов ─────────────────────────────────────────────────────────────

export type ReportedBy = "client" | "staff" | "chief" | "check";

/** Вид задачи → ключ подписи. Record по типу: новый вид без подписи не соберётся. */
export const KIND_LABEL_KEYS: Record<TodoKind, string> = {
	task: "todoKindTask",
	client_request: "todoKindClientRequest",
	error: "todoKindError",
	control: "todoKindControl",
	check_finding: "todoKindCheckFinding",
	regulation: "todoKindRegulation",
	manager_order: "todoKindManagerOrder",
};

export const PRIORITY_LABEL_KEYS: Record<Priority, string> = {
	low: "todoPriorityLow",
	normal: "todoPriorityNormal",
	high: "todoPriorityHigh",
	urgent: "todoPriorityUrgent",
};

/** Кто нашёл ошибку. client — п. 4 («ошибку первым выявил клиент»). */
export const REPORTED_BY_LABEL_KEYS: Record<ReportedBy, string> = {
	client: "todoReportedByClient",
	staff: "todoReportedByStaff",
	chief: "todoReportedByChief",
	check: "todoReportedByCheck",
};

/** Типы событий журнала задачи (schema.prisma, model TodoEvent). */
export const EVENT_LABEL_KEYS: Record<string, string> = {
	created: "todoEventCreated",
	accepted: "todoEventAccepted",
	status: "todoEventStatus",
	transfer: "todoEventTransfer",
	reminder: "todoEventReminder",
	returned: "todoEventReturned",
	help: "todoEventHelp",
	escalation: "todoEventEscalation",
	result: "todoEventResult",
	rating: "todoEventRating",
	control: "todoEventControl",
	control_date: "todoEventControlDate",
};

/** Каналы событий: erp | 1c-chat | phone | whatsapp | system. */
export const CHANNEL_LABEL_KEYS: Record<string, string> = {
	erp: "todoChannelErp",
	"1c-chat": "todoChannelOnec",
	phone: "todoChannelPhone",
	whatsapp: "todoChannelWhatsapp",
	system: "todoChannelSystem",
};

/** Почему пользователь наблюдает за задачей: transfer — передал её, manual — подписался сам. */
export const WATCHER_REASON_KEYS: Record<string, string> = {
	transfer: "todoWatcherTransfer",
	manual: "todoWatcherManual",
};

/**
 * Каналы, по которым клиент напоминает о поручении (диалог «Клиент напомнил»).
 * ПРОВЕРИТЬ ПОТОМ: набор каналов — решение владельца №2 плана («по каким каналам приходят
 * обращения»); erp здесь означает «другой канал, отмечено сотрудником».
 */
export const REMIND_CHANNELS: { value: string; key: string }[] = [
	{ value: "phone", key: "todoChannelPhone" },
	{ value: "whatsapp", key: "todoChannelWhatsapp" },
	{ value: "erp", key: "todoRemindChannelOther" },
];

/** Подпись кода по карте ключей; неизвестный код — как есть: пустое место не отличить от «нет значения». */
function labelOf(map: Record<string, string>, code: unknown): string {
	const c = asText(code).trim();
	if (!c) return "";
	const key = map[c];
	return key ? translate(key) : c;
}

export const kindLabel = (code: unknown): string => labelOf(KIND_LABEL_KEYS, code);
export const priorityLabel = (code: unknown): string => labelOf(PRIORITY_LABEL_KEYS, code);
export const reportedByLabel = (code: unknown): string => labelOf(REPORTED_BY_LABEL_KEYS, code);
export const eventLabel = (code: unknown): string => labelOf(EVENT_LABEL_KEYS, code);
export const channelLabel = (code: unknown): string => labelOf(CHANNEL_LABEL_KEYS, code);
export const watcherReasonLabel = (code: unknown): string => labelOf(WATCHER_REASON_KEYS, code);

export interface SelectOption { value: string; label: string }

/**
 * Сводную задачу по находкам проверки учёта ставит и закрывает прогон (СК2.3): вручную такую
 * не заводят, и вид у неё не меняют — иначе прогон перестал бы её находить.
 */
export const isKindLocked = (kind: string): boolean => kind === "check_finding";

/** Варианты вида задачи для формы. Неизвестный текущий код остаётся в списке — иначе select солгал бы. */
export function kindOptions(current: string): SelectOption[] {
	const codes = (Object.keys(KIND_LABEL_KEYS) as TodoKind[]).filter((k) => k !== "check_finding" || current === "check_finding");
	const out: SelectOption[] = codes.map((k) => ({ value: k, label: kindLabel(k) }));
	if (current && !(current in KIND_LABEL_KEYS)) out.push({ value: current, label: current });
	return out;
}

export function priorityOptions(current: string): SelectOption[] {
	const out: SelectOption[] = (Object.keys(PRIORITY_LABEL_KEYS) as Priority[]).map((p) => ({ value: p, label: priorityLabel(p) }));
	if (current && !(current in PRIORITY_LABEL_KEYS)) out.push({ value: current, label: current });
	return out;
}

/** «Кто нашёл ошибку»: необязательно — пустой вариант первым. */
export function reportedByOptions(): SelectOption[] {
	return [
		{ value: "", label: "—" },
		...(Object.keys(REPORTED_BY_LABEL_KEYS) as ReportedBy[]).map((r) => ({ value: r, label: reportedByLabel(r) })),
	];
}

// ── Статусы ───────────────────────────────────────────────────────────────────

export interface StatusLike { code: string; name?: string; isFinal: boolean; isWaiting?: boolean; isCancel?: boolean }

/**
 * Коды отмены по умолчанию — только для записей справочника без признака `isCancel` (как на сервере,
 * taskRules.js). Отменённая задача не выполнялась, результат ей не нужен. Свой статус отмены с любым
 * кодом помечают признаком «Отмена» в справочнике статусов (решено 25.09).
 */
export const CANCEL_CODES: ReadonlySet<string> = new Set(["cancelled", "canceled", "cancel"]);

export const statusOf = (statuses: readonly StatusLike[], code: string): StatusLike | null =>
	statuses.find((s) => s.code === code) ?? null;
export const isFinalStatus = (statuses: readonly StatusLike[], code: string): boolean => !!statusOf(statuses, code)?.isFinal;
export const isWaitingStatus = (statuses: readonly StatusLike[], code: string): boolean => !!statusOf(statuses, code)?.isWaiting;
export const isCancelStatus = (statuses: readonly StatusLike[], code: string): boolean => {
	const st = statusOf(statuses, code);
	if (!st?.isFinal) return false;
	return st.isCancel === true || (st.isCancel === undefined && CANCEL_CODES.has(code));
};
/** Статус закрывает задачу и требует результата (финальный, но не отмена). */
export const needsResult = (statuses: readonly StatusLike[], code: string): boolean =>
	isFinalStatus(statuses, code) && !isCancelStatus(statuses, code);

/** Варианты статуса для формы; текущий код вне справочника показываем как есть, а не подменяем первым. */
export function statusOptions(statuses: readonly StatusLike[], current: string): SelectOption[] {
	const out = statuses.map((s) => ({ value: s.code, label: s.name || s.code }));
	if (current && !statuses.some((s) => s.code === current)) out.push({ value: current, label: current });
	return out;
}

// ── Результат и переход статуса ───────────────────────────────────────────────

export const MIN_RESULT_LENGTH = 10;

/**
 * «Формальный» результат — то, что стандарт прямо называет не-результатом (п. 1).
 * Тот же перечень, что на сервере (FORMAL_RESULT_RE): расходиться им нельзя, иначе форма
 * пропустит то, что отвергнет сервер, или наоборот.
 * Перечень решён 25.09: слова стандарта и очевидно пустые ответы («сделано», «готово», «ок»).
 * Меняют его в трёх местах вместе: здесь, backend/services/quality/taskRules.js, ai/src/tools/registry.ts.
 */
const FORMAL_RESULT_RE = /^(написал[аи]?|позвонил[аи]?|передал[аи]?|отправил[аи]?|не ответил[аи]?|не отвечают|программа не работает|сделано|сделал[аи]?|готово|выполнено|выполнил[аи]?|ок|ok|\+|-)$/i;

/** Текст ошибки результата или null, если результат годится. */
export function resultError(result: unknown): string | null {
	const text = asText(result).trim();
	if (!text) return translate("todoResultRequired");
	const bare = text.replace(/[.!…\s]+$/u, "").trim();
	if (FORMAL_RESULT_RE.test(bare)) return translate("todoResultFormal");
	if (text.length < MIN_RESULT_LENGTH) return translate("todoResultTooShort").replace("{n}", String(MIN_RESULT_LENGTH));
	return null;
}

/** Проверка перехода задачи в статус. null — можно, иначе текст для человека. */
export function transitionError(p: {
	nextStatus: string;
	statuses: readonly StatusLike[];
	result?: unknown;
	nextControlAt?: unknown;
}): string | null {
	const st = statusOf(p.statuses, p.nextStatus);
	if (!st) return null; // код вне справочника — не наш вопрос: его отвергнет или примет сервер
	if (st.isFinal && !isCancelStatus(p.statuses, st.code)) {
		const err = resultError(p.result);
		if (err) return err;
	}
	if (st.isWaiting && !asText(p.nextControlAt).trim()) return translate("todoNextControlRequired");
	return null;
}

/**
 * Проверка формы задачи перед записью — как prepareCreate/prepareUpdate сервера.
 * Правку УЖЕ закрытой задачи без смены статуса результатом задним числом не блокируем:
 * задачи, закрытые до E17, остались без результата, и поправить в них срок или описание
 * должно быть можно.
 */
export function todoFormError(p: {
	isEdit: boolean;
	status: string;
	/** Статус, с которым задача загружена (после записи — записанный). */
	loadedStatus: string;
	statuses: readonly StatusLike[];
	result: string;
	nextControlAt: string;
}): string | null {
	if (p.isEdit && p.status === p.loadedStatus && isFinalStatus(p.statuses, p.loadedStatus)) return null;
	return transitionError({ nextStatus: p.status, statuses: p.statuses, result: p.result, nextControlAt: p.nextControlAt });
}

// ── Действия над задачей ──────────────────────────────────────────────────────

export interface TodoActionState {
	/** «Принять в работу» — обращение клиента, ещё не принятое (п. 3). */
	accept: boolean;
	/** «Клиент напомнил» — по незакрытой задаче (п. 2). */
	remind: boolean;
	/** «Вернуть: не выполнено» — только закрытую (п. 1). */
	returnBack: boolean;
	/** «Нужна помощь» — по незакрытой задаче (п. 40). */
	help: boolean;
	/** «Оценка клиента» (СК7.2). */
	rate: boolean;
}

/**
 * Какие действия предлагать. Сервер решает сам (и откажет 400 с причиной) — здесь только то,
 * что заведомо бессмысленно: напоминание по закрытой задаче, возврат открытой.
 */
export function todoActions(p: {
	isSaved: boolean;
	kind: string;
	status: string;
	acceptedAt: string;
	statuses: readonly StatusLike[];
}): TodoActionState {
	if (!p.isSaved) return { accept: false, remind: false, returnBack: false, help: false, rate: false };
	const final = isFinalStatus(p.statuses, p.status);
	return {
		accept: p.kind === "client_request" && !p.acceptedAt && !final,
		remind: !final,
		returnBack: final,
		help: !final,
		rate: true,
	};
}

/** Обращение клиента не принято в работу к сроку реакции по SLA (п. 3). */
export function reactionOverdue(
	t: { kind?: unknown; acceptedAt?: unknown; reactionDueAt?: unknown; status?: unknown },
	finalCodes: ReadonlySet<string>,
	now: number = Date.now(),
): boolean {
	if (asText(t.kind) !== "client_request" || asText(t.acceptedAt) || finalCodes.has(asText(t.status))) return false;
	const due = new Date(asText(t.reactionDueAt)).getTime();
	return Number.isFinite(due) && due < now;
}

// ── История задачи ────────────────────────────────────────────────────────────

/** Строка таблицы «История». type, а не interface: таблице нужна строка-словарь (TDataItem). */
export type HistoryRow = {
	uuid: string;
	/** ISO-момент события (колонка типа datetime, формат — таблица). */
	todoEventAt: string;
	todoEventType: string;
	todoEventActor: string;
	todoEventDetails: string;
	todoEventChannel: string;
	comment: string;
};

/**
 * Подробности события одной строкой: «от кого → кому» у передачи, «было → стало» у статуса,
 * оценка, уровень эскалации. Текст самого события (причина, результат, комментарий) — в `note`.
 */
export function eventDetails(e: Pick<TodoEventRow, "type" | "fromUserName" | "toUserName" | "payload">, statusName: (code: string) => string): string {
	const p = e.payload ?? {};
	switch (e.type) {
		case "transfer":
			return `${e.fromUserName || "—"} → ${e.toUserName || "—"}`;
		case "status": {
			const from = asText(p.from);
			const to = asText(p.to);
			return from || to ? `${from ? statusName(from) : "—"} → ${to ? statusName(to) : "—"}` : "";
		}
		case "rating":
			return p.rating != null ? translate("todoRatingValue").replace("{n}", asText(p.rating)) : "";
		case "escalation": {
			const level = Number(p.level);
			if (level >= 2) return translate("todoEscalationManager");
			if (level === 1) return translate("todoEscalationChief");
			return "";
		}
		case "created": {
			const parts: string[] = [];
			if (p.kind) parts.push(kindLabel(p.kind));
			if (e.toUserName) parts.push(`${translate("executor")}: ${e.toUserName}`);
			return parts.join(" · ");
		}
		case "control":
			return e.toUserName ? `${translate("todoControlBy")}: ${e.toUserName}` : "";
		default:
			return "";
	}
}

/** Строки таблицы «История»: новые сверху — так читают журнал задачи. */
export function historyRows(events: readonly TodoEventRow[], statusName: (code: string) => string): HistoryRow[] {
	return [...events]
		.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
		.map((e) => ({
			uuid: e.uuid,
			todoEventAt: e.createdAt,
			todoEventType: eventLabel(e.type),
			// Системное событие (эскалация, дата контроля) — без автора: «Система», а не пустота.
			todoEventActor: e.actorName || (e.channel === "system" ? translate("todoChannelSystem") : "—"),
			todoEventDetails: eventDetails(e, statusName),
			todoEventChannel: channelLabel(e.channel),
			comment: e.note ?? "",
		}));
}

export interface WatcherView { uuid: string; name: string; reason: string; since: string }

/** Наблюдатели: кто и почему (передавший задачу остаётся на связи до закрытия, п. 22). */
export function watcherViews(watchers: readonly TodoWatcherRow[]): WatcherView[] {
	return watchers.map((w) => ({ uuid: w.uuid, name: w.userName || w.userUuid, reason: watcherReasonLabel(w.reason), since: w.createdAt }));
}
