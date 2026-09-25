/**
 * Чистые помощники экрана «Проверки учёта 1С» (E17 СК2): отборы списков находок и прогонов,
 * подписи состояний и важности, разбор данных находки, пришедших из 1С.
 *
 * Без React: компонентный модуль экспортирует только компоненты (Fast Refresh), а правила
 * отбора проверяются тестом отдельно от экрана.
 */
import { translate } from "src/i18";
import { asText } from "src/utils/asText";
import type { QualityTone } from "src/models/_quality/QualityChip";
import { QUALITY_AREAS, areaLabel, checkCodesOfArea, type QualityArea } from "src/services/quality/checkCatalog";

/** Ключи отложенных отборов (paneFilterBus) — по одному на список. */
export const FINDINGS_FILTER_KEY = "check-findings";
export const RUNS_FILTER_KEY = "check-runs";

export type FindingState = "open" | "exception" | "resolved";
export type FindingStateFilter = FindingState | "all";
export type FindingSeverity = "error" | "warning" | "info";
export type RunStatus = "ok" | "findings" | "skipped" | "error";

export const FINDING_STATE_FILTERS: readonly FindingStateFilter[] = ["open", "exception", "resolved", "all"];
export const FINDING_SEVERITIES: readonly FindingSeverity[] = ["error", "warning", "info"];
export const RUN_STATUSES: readonly RunStatus[] = ["ok", "findings", "skipped", "error"];

/** Состояние находки в строке и карточке («открыта») — и вариант отбора списка («открытые»). */
const STATE_KEYS: Record<FindingState, string> = {
	open: "findingStateOpen",
	exception: "findingStateException",
	resolved: "findingStateResolved",
};
const STATE_FILTER_KEYS: Record<FindingStateFilter, string> = {
	open: "findingsFilterOpen",
	exception: "findingsFilterException",
	resolved: "findingsFilterResolved",
	all: "findingsFilterAll",
};
const SEVERITY_KEYS: Record<FindingSeverity, string> = {
	error: "findingSeverityError",
	warning: "findingSeverityWarning",
	info: "findingSeverityInfo",
};
const RUN_STATUS_KEYS: Record<RunStatus, string> = {
	ok: "checkRunStatusOk",
	findings: "checkRunStatusFindings",
	skipped: "checkRunStatusSkipped",
	error: "checkRunStatusError",
};

/** Виды объектов 1С в находке (как в разметке ссылок чата + fixedAsset, bankAccount). */
const OBJECT_KIND_KEYS: Record<string, string> = {
	sale: "findingObjSale",
	purchase: "findingObjPurchase",
	invoice: "findingObjInvoice",
	cashIn: "findingObjCashIn",
	cashOut: "findingObjCashOut",
	paymentIn: "findingObjPaymentIn",
	paymentOut: "findingObjPaymentOut",
	act: "findingObjAct",
	counterparty: "findingObjCounterparty",
	product: "findingObjProduct",
	organization: "findingObjOrganization",
	warehouse: "findingObjWarehouse",
	contract: "findingObjContract",
	fixedAsset: "findingObjFixedAsset",
	bankAccount: "findingObjBankAccount",
	document: "findingObjDocument",
};

const keyed = (map: Record<string, string>, v: string): string => (map[v] ? translate(map[v]) : v);

export const findingStateLabel = (s: string): string => keyed(STATE_KEYS, s);
export const severityLabel = (s: string): string => keyed(SEVERITY_KEYS, s);
export const runStatusLabel = (s: string): string => keyed(RUN_STATUS_KEYS, s);
export const objectKindLabel = (kind: string): string => keyed(OBJECT_KIND_KEYS, kind);

/** Цвет метки важности: ошибка — красный, предупреждение — оранжевый, подсказка — серый. */
export function severityTone(s: string): QualityTone {
	if (s === "error") return "bad";
	if (s === "warning") return "warn";
	return "muted";
}

/** Цвет метки состояния: открыта — ждёт работы, исключение — решение главбуха, устранена — хорошо. */
export function findingStateTone(s: string): QualityTone {
	if (s === "resolved") return "ok";
	if (s === "exception") return "info";
	if (s === "open") return "warn";
	return "muted";
}

export function runStatusTone(s: string): QualityTone {
	if (s === "ok") return "ok";
	if (s === "error") return "bad";
	if (s === "findings") return "warn";
	return "muted";
}

// ── Отборы ───────────────────────────────────────────────────────────────────

export interface FindingsFilter {
	organizationUuid: string;
	organizationName: string;
	state: FindingStateFilter;
	severity: FindingSeverity | "";
	area: QualityArea | "";
	checkCode: string;
}

export const EMPTY_FINDINGS_FILTER: FindingsFilter = {
	organizationUuid: "",
	organizationName: "",
	state: "open",
	severity: "",
	area: "",
	checkCode: "",
};

type FilterValue = string | { value: unknown; operator: string };

/**
 * Отбор из данных панели (открыли с панели главбуха или восстановили после перезагрузки):
 * берём только известные поля и только допустимые значения.
 */
export function pickFindingsFilter(data: Record<string, unknown> | null | undefined): Partial<FindingsFilter> {
	if (!data) return {};
	const out: Partial<FindingsFilter> = {};
	const org = asText(data.organizationUuid);
	if (org) {
		out.organizationUuid = org;
		out.organizationName = asText(data.organizationName);
	}
	const state = asText(data.state);
	if ((FINDING_STATE_FILTERS as readonly string[]).includes(state)) out.state = state as FindingStateFilter;
	const severity = asText(data.severity);
	if ((FINDING_SEVERITIES as readonly string[]).includes(severity)) out.severity = severity as FindingSeverity;
	const area = asText(data.area);
	if ((QUALITY_AREAS as readonly string[]).includes(area)) out.area = area as QualityArea;
	const checkCode = asText(data.checkCode);
	if (checkCode) out.checkCode = checkCode;
	return out;
}

/**
 * Параметры запроса списка находок.
 *
 * Состояние и организацию роут читает прямыми параметрами (state=, organizationUuid=), важность
 * и проверку — как filter[поле][оператор]. Участок — это набор кодов проверок: отбор
 * `checkCode in (…)`; выбранная проверка точнее участка и заменяет его.
 * Проверки вне каталога (1С добавила новую) в отбор по участку не попадают — их видно без отбора.
 */
export function findingsQuery(f: FindingsFilter): { extraQueryParams: Record<string, string>; extraFilter?: Record<string, FilterValue> } {
	const extraQueryParams: Record<string, string> = { state: f.state };
	if (f.organizationUuid) extraQueryParams.organizationUuid = f.organizationUuid;
	const extraFilter: Record<string, FilterValue> = {};
	if (f.severity) extraFilter.severity = f.severity;
	if (f.checkCode) {
		extraFilter.checkCode = f.checkCode;
	} else if (f.area) {
		const codes = checkCodesOfArea(f.area);
		if (codes.length) extraFilter.checkCode = { operator: "in", value: codes.join(",") };
	}
	return { extraQueryParams, extraFilter: Object.keys(extraFilter).length ? extraFilter : undefined };
}

export interface RunsFilter {
	organizationUuid: string;
	organizationName: string;
	status: RunStatus | "";
}

export const EMPTY_RUNS_FILTER: RunsFilter = { organizationUuid: "", organizationName: "", status: "" };

export function pickRunsFilter(data: Record<string, unknown> | null | undefined): Partial<RunsFilter> {
	if (!data) return {};
	const out: Partial<RunsFilter> = {};
	const org = asText(data.organizationUuid);
	if (org) {
		out.organizationUuid = org;
		out.organizationName = asText(data.organizationName);
	}
	const status = asText(data.status);
	if ((RUN_STATUSES as readonly string[]).includes(status)) out.status = status as RunStatus;
	return out;
}

export function runsQuery(f: RunsFilter): { extraQueryParams?: Record<string, string>; extraFilter?: Record<string, FilterValue> } {
	return {
		extraQueryParams: f.organizationUuid ? { organizationUuid: f.organizationUuid } : undefined,
		extraFilter: f.status ? { status: f.status } : undefined,
	};
}

// ── Варианты выбора ──────────────────────────────────────────────────────────

export type Option = { value: string; label: string };

export const stateOptions = (): Option[] => FINDING_STATE_FILTERS.map((s) => ({ value: s, label: translate(STATE_FILTER_KEYS[s]) }));

export const severityOptions = (): Option[] => [
	{ value: "", label: translate("findingsAllSeverities") },
	...FINDING_SEVERITIES.map((s) => ({ value: s, label: severityLabel(s) })),
];

export const areaOptions = (): Option[] => [
	{ value: "", label: translate("findingsAllAreas") },
	...QUALITY_AREAS.map((a) => ({ value: a, label: areaLabel(a) })),
];

export const runStatusOptions = (): Option[] => [
	{ value: "", label: translate("checkRunsAllStatuses") },
	...RUN_STATUSES.map((s) => ({ value: s, label: runStatusLabel(s) })),
];

// ── Данные находки из 1С ─────────────────────────────────────────────────────

export interface FindingObject { kind: string; id: string; name: string }
export interface FindingDocument {
	kind: string;
	documentType: string;
	id: string;
	number: string;
	date: string;
	posted: boolean | null;
	author: string;
}

const asRecords = (v: unknown): Record<string, unknown>[] =>
	Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

/** Объекты находки (контрагент, номенклатура, склад…) — только строки с видом или id. */
export function findingObjects(data: unknown): FindingObject[] {
	const objects = (data as { objects?: unknown } | null)?.objects;
	return asRecords(objects)
		.map((o) => ({ kind: asText(o.kind), id: asText(o.id), name: asText(o.name) }))
		.filter((o) => o.kind || o.id);
}

/** Документы находки с идентификаторами 1С. */
export function findingDocuments(data: unknown): FindingDocument[] {
	const documents = (data as { documents?: unknown } | null)?.documents;
	return asRecords(documents)
		.map((d) => ({
			kind: asText(d.kind),
			documentType: asText(d.documentType),
			id: asText(d.id),
			number: asText(d.number),
			date: asText(d.date),
			posted: typeof d.posted === "boolean" ? d.posted : null,
			author: asText(d.author),
		}))
		.filter((d) => d.kind || d.id || d.number);
}

/**
 * Реквизиты находки (`details`) для показа как есть: JSON с отступами. Пустой объект — пустая
 * строка, чтобы экран сказал «нет данных», а не показал «{}».
 */
export function formatDetails(details: unknown): string {
	if (details === null || details === undefined) return "";
	if (typeof details === "object" && !Array.isArray(details) && Object.keys(details).length === 0) return "";
	try {
		return JSON.stringify(details, null, 2);
	} catch {
		return "";
	}
}
