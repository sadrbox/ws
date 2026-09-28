/**
 * Строки таблиц карточки агента и виджета «Кто держит очередь» (28.09): команды, журнал, базы бизнес-агента, базы
 * из его сводки, процессы сервера, выданные команды, время и отказы команд.
 *
 * Без JSX, отдельным модулем: в модуле-компоненте только компоненты (Fast Refresh), а строки проверяются тестом.
 *
 * ПРАВИЛО СТРОКИ. Значение колонки лежит под её идентификатором (он же ключ перевода заголовка) — текстом или
 * числом: по нему работают быстрый поиск и сортировка таблицы. Даты — ISO-строкой, формат накладывает сама таблица
 * (колонка `datetime`). Вид — тон, моноширинный шрифт, кнопки — накладывает renderCell компонента по служебным
 * полям `__*`.
 */
import { translate } from "src/i18";
import type { TColumn, TDataItem } from "src/components/Table/types";
import { withStableIds } from "src/utils/stableRowId";
import { getFormatDate } from "src/utils/datetime";
import type { AgentAuditItem, AgentBaseRow, AgentCommand, AgentHealth, BusinessHealth, OnecQueueStats } from "src/services/onec/api";
import { auditDetailsText, auditEventLabel, commandStateLabel, commandStateTone, healthBaseState } from "./agentActivityView";
import { baseState, baseStateLabel, transportLabel, type BaseState } from "./agentBasesView";
import { durationRows, failureRows, type DurationStat } from "./agentStats";
import { formatDuration } from "./queueStats";
import { withCodeHint } from "src/services/onec/commandFacts";

/**
 * Ключи строк без повторов: одинаковые получают «#2», «#3» по порядку прихода. Две записи журнала в одну секунду
 * или база без имени в сводке — не повод склеить строки в одну.
 */
function uniqueKeys<T>(items: readonly T[], keyOf: (item: T) => string): string[] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const key = keyOf(item);
		const n = (seen.get(key) ?? 0) + 1;
		seen.set(key, n);
		return n > 1 ? `${key}#${n}` : key;
	});
}

/** Сколько идёт: «0 с» у только что запущенного — это не «неизвестно сколько»; нет числа — прочерк. */
export const ageText = (secs: unknown): string =>
	(typeof secs === "number" ? formatDuration(secs) || `0 ${translate("secShort")}` : "—");

// ── Команды агента ───────────────────────────────────────────────────────────────────────────────────

export type CommandRow = TDataItem & {
	__state: string;
	__tone: ReturnType<typeof commandStateTone>;
	/** Отказ одной строкой («код: текст»); пусто — отказа нет. */
	__error: string;
	/** Когда агент взял команду: у незавершённой вместо времени завершения. */
	__startedAt: string | null;
};

export function commandRows(items: readonly AgentCommand[]): CommandRow[] {
	return withStableIds(items.map((c) => ({
		uuid: c.id,
		onecCmdCreated: c.createdAt,
		onecCmdType: c.type,
		onecBase: c.baseKey || "—",
		status: commandStateLabel(c.state),
		onecCmdFinished: c.finishedAt ?? null,
		__state: c.state,
		__tone: commandStateTone(c.state),
		// Подсказка по коду отказа (С2, 28.09): у «вход закрыт блокировкой начала сеансов» — что делать.
		__error: c.error?.message ? `${c.error.code ? `${c.error.code}: ` : ""}${withCodeHint(c.error.message, c.error.code)}` : "",
		__startedAt: c.dispatchedAt,
	})), (r) => r.uuid);
}

/** «Завершена»: время завершения формирует таблица; идёт — «начата …»; ни того ни другого — прочерк. */
export function commandFinishedText(r: CommandRow): string | undefined {
	if (r.onecCmdFinished) return undefined;
	return r.__startedAt ? `${translate("onecCmdStartedAt")} ${getFormatDate(r.__startedAt)}` : "—";
}

// ── Журнал действий над агентом ──────────────────────────────────────────────────────────────────────

export function auditRows(items: readonly AgentAuditItem[]): TDataItem[] {
	const keys = uniqueKeys(items, (x) => `${x.at}|${x.event}|${x.userUuid ?? ""}`);
	return withStableIds(items.map((x, i) => ({
		uuid: keys[i],
		onecAuditAt: x.at,
		onecAuditEvent: auditEventLabel(x.event),
		onecAuditWho: x.userName || translate("onecAuditSystem"),
		onecAuditDetails: auditDetailsText(x.details),
	})), (r) => r.uuid);
}

// ── Базы в сводке бизнес-агента (HEALTH) ─────────────────────────────────────────────────────────────

type HealthBase = NonNullable<BusinessHealth["bases"]>[number];

export type HealthBaseRow = TDataItem & {
	/** Сверх лимита — по мнению агента (`overLimit` или прежний статус `OVER_LIMIT`). */
	__over: boolean;
	/** Последний отказ одной строкой: когда и что. Нет — прочерк. */
	__lastError: string;
};

export function healthBaseRows(bases: readonly HealthBase[]): HealthBaseRow[] {
	const keys = uniqueKeys(bases, (b) => b.baseKey ?? b.key ?? "");
	return withStableIds(bases.map((b, i) => ({
		uuid: keys[i],
		onecBase: b.baseKey ?? b.key ?? "—",
		status: `${healthBaseState(b)}${b.error ? ` · ${b.error}` : ""}`,
		onecTransport: b.transport ? b.transport.toUpperCase() : "—",
		onecExtVersion: b.extVersion ?? "—",
		// Недоступная база без времени выглядит одинаково и через минуту молчания, и через неделю.
		onecHealthLastOk: b.lastOkAt ?? null,
		onecHealthLastError: b.lastError?.at ?? null,
		__over: !!b.overLimit || b.status === "OVER_LIMIT",
		__lastError: [b.lastError?.at ? getFormatDate(b.lastError.at) : "", b.lastError?.message ?? ""].filter(Boolean).join(" ") || "—",
	})), (r) => r.uuid);
}

// ── Базы бизнес-агента и лимит тарифа ────────────────────────────────────────────────────────────────

export type AgentBaseTableRow = TDataItem & {
	__state: BaseState;
	/** База целиком — организации с пометками рисует ячейка; поиск объекты не читает. */
	__base: AgentBaseRow;
};

/** Организации базы одной строкой — для поиска и сортировки; вид с пометками и кнопками рисует ячейка. */
export function baseOrgsText(orgs: AgentBaseRow["organizations"]): string {
	if (orgs === null) return translate("onecOrgsUnknown");
	if (!orgs.length) return "—";
	return orgs.map((o) => [o.name || "—", o.bin].filter(Boolean).join(" ")).join(", ");
}

export function agentBaseRows(bases: readonly AgentBaseRow[]): AgentBaseTableRow[] {
	return withStableIds(bases.map((b, i) => {
		const state = baseState(b);
		return {
			uuid: b.key,
			// Номер — порядок баз в настройках агента: по нему сервис и считает лимит.
			lineNumber: i + 1,
			onecBase: b.key,
			onecTransport: transportLabel(b.transport),
			onecExtVersion: b.extVersion || "—",
			organizations: baseOrgsText(b.organizations),
			status: baseStateLabel(state),
			__state: state,
			__base: b,
		};
	}), (r) => r.uuid);
}

// ── Процессы сервера 1С (AGENT_HEALTH) ───────────────────────────────────────────────────────────────

type HealthProcess = NonNullable<AgentHealth["processes"]>[number];

export type ProcessRow = TDataItem & { __orphan: boolean };

export function processRows(processes: readonly HealthProcess[]): ProcessRow[] {
	return withStableIds(processes.map((p) => ({
		uuid: String(p.pid),
		pid: p.pid,
		onecHealthTool: p.tool ?? "—",
		onecHealthWhat: `${p.what ?? "—"}${p.orphan ? ` (${translate("onecHealthOrphan")})` : ""}`,
		onecQueueBase: p.base ?? "—",
		onecQueueAge: typeof p.ageSecs === "number" ? p.ageSecs : null,
		__orphan: !!p.orphan,
	})), (r) => r.uuid);
}

// ── Кто держит очередь ───────────────────────────────────────────────────────────────────────────────

type RunningCommand = NonNullable<OnecQueueStats["runningCommands"]>[number];

export type HolderRow = TDataItem & { __abortable: boolean };

export function holderRows(commands: readonly RunningCommand[]): HolderRow[] {
	return withStableIds(commands.map((c) => ({
		uuid: c.commandId,
		onecStatType: c.type,
		onecQueueBase: c.baseKey ?? "—",
		onecQueueAge: c.ageSecs,
		__abortable: c.abortable,
	})), (r) => r.uuid);
}

// ── Время и отказы команд (S5) ───────────────────────────────────────────────────────────────────────

/**
 * Время по типам: порядок и подписи — из durationRows (по убыванию среднего, корзина 95-го перцентиля), а в
 * колонках — миллисекунды и секунды числом: иначе сортировка сравнивала бы «28,2 с» и «2 мин» как строки.
 */
export function durationTableRows(d: Record<string, DurationStat> | undefined): TDataItem[] {
	const stats = d ?? {};
	return withStableIds(durationRows(d).map((r) => ({
		uuid: r.type,
		onecStatType: r.type,
		onecStatCount: r.count,
		onecStatAvg: stats[r.type]?.avgMs ?? null,
		onecStatP95: stats[r.type]?.p95LeSecs ?? null,
		onecStatMax: stats[r.type]?.maxMs ?? null,
		__text: { onecStatAvg: r.avg, onecStatP95: r.p95, onecStatMax: r.max },
	})), (r) => r.uuid);
}

/** Время — подписью агента («28,2 с», «≤ 60 с»); число под ней нужно только сортировке. */
export const durationCellText = (row: TDataItem, col: TColumn): string | undefined =>
	(row.__text as Record<string, string> | undefined)?.[col.identifier];

export function failureTableRows(f: Record<string, number> | undefined): TDataItem[] {
	return withStableIds(failureRows(f).map((r) => ({ uuid: r.code, onecStatCode: r.code, onecStatCount: r.count })), (r) => r.uuid);
}

/** Колонки «Времени по типам» — общие у карточки агента и у виджета очереди. */
export const durationColumns = (): TColumn[] => [
	{ identifier: "onecStatType", type: "string", width: "240px", minWidth: "140px", alignment: "left", visible: true, inlist: true },
	{ identifier: "onecStatCount", type: "number", width: "100px", minWidth: "70px", alignment: "right", visible: true, inlist: true },
	{ identifier: "onecStatAvg", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "onecStatP95", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
	{ identifier: "onecStatMax", type: "number", width: "120px", minWidth: "80px", alignment: "right", visible: true, inlist: true },
];
