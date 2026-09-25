/**
 * Реестр нарушений стандарта (E17 СК5) — чистые правила экрана: подписи и тона статусов,
 * доказательства, история решений, какие действия доступны, проверка перед отправкой.
 *
 * Отдельным модулем, а не в index.tsx: тот отдаёт только компоненты (Fast Refresh), а эти
 * функции проверяются юнит-тестом (src/__tests__/qualityViolations.test.ts).
 *
 * Правила — те же, что у сервера (backend/api/router/standardViolations.js): панель лишь
 * заранее говорит то, что сервер всё равно ответил бы отказом, и прячет недоступные кнопки.
 * Решает сервер: он и проверяет, кто вправе подтверждать (уровнем выше нарушителя).
 */
import { translate } from "src/i18";
import { getFormatDateOnly } from "src/utils/datetime";
import { asText } from "src/utils/asText";
import type { EvidenceRow, Violation, ViolationStatus } from "src/services/quality/api";
import type { QualityTone } from "src/models/_quality/QualityChip";

export const VIOLATION_STATUSES: readonly ViolationStatus[] = ["candidate", "confirmed", "disputed", "rejected"];

/** Ключи перевода статусов. */
export const VIOLATION_STATUS_KEYS: Record<ViolationStatus, string> = {
	candidate: "violationStatusCandidate",
	confirmed: "violationStatusConfirmed",
	disputed: "violationStatusDisputed",
	rejected: "violationStatusRejected",
};

/**
 * Тон метки статуса. Подтверждённое — красное (бонус снят), кандидат — оранжевый (ждёт решения),
 * возражение — синее (на рассмотрении), отклонённое — серое (нарушением не считается и ни на что
 * не влияет).
 */
const STATUS_TONES: Record<ViolationStatus, QualityTone> = { candidate: "warn", confirmed: "bad", disputed: "info", rejected: "muted" };

const isStatus = (s: unknown): s is ViolationStatus => typeof s === "string" && (VIOLATION_STATUSES as readonly string[]).includes(s);

/** Подпись статуса; неизвестный код показываем как есть — пустая ячейка не отличима от «нет статуса». */
export function statusLabel(status: unknown): string {
	return isStatus(status) ? translate(VIOLATION_STATUS_KEYS[status]) : asText(status);
}

export function statusTone(status: unknown): QualityTone {
	return isStatus(status) ? STATUS_TONES[status] : "muted";
}

/** Источник записи: правило (`rule:<код>`) или ручная фиксация (`manual`). */
export function isRuleSource(source: unknown): boolean {
	return typeof source === "string" && source.startsWith("rule:");
}

export function sourceKey(source: unknown): string {
	return isRuleSource(source) ? "violationSourceRule" : "violationSourceManual";
}

/** «п. 12 — Нарушение сроков»: номер пункта и его краткая формулировка. */
export function itemCaption(itemNumber: unknown, itemTitle?: unknown): string {
	const n = Number(itemNumber);
	if (!Number.isFinite(n) || n <= 0) return "";
	const title = typeof itemTitle === "string" ? itemTitle.trim() : "";
	return `${translate("violationItemShort")} ${n}${title ? ` — ${title}` : ""}`;
}

// ── Доказательства ───────────────────────────────────────────────────────────

/**
 * Куда ведёт доказательство. Задача, находка проверки учёта и прогон чек-листа — записи ERP со
 * своими формами; документ несёт свой endpoint. Участок и посещаемость — просто факт, открывать
 * нечего.
 */
const EVIDENCE_ENDPOINTS: Record<string, string> = { todo: "todos", finding: "check-findings", checklist: "checklist-runs" };

const EVIDENCE_KIND_KEYS: Record<string, string> = {
	todo: "violationEvidenceTodo",
	finding: "violationEvidenceFinding",
	checklist: "violationEvidenceChecklist",
	document: "violationEvidenceDocument",
	area: "violationEvidenceArea",
	attendance: "violationEvidenceAttendance",
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function evidenceKindKey(kind: unknown): string {
	return EVIDENCE_KIND_KEYS[str(kind)] ?? "violationEvidenceOther";
}

export function evidenceTarget(e: EvidenceRow): { endpoint: string; uuid: string } | null {
	const uuid = str(e.uuid);
	if (!uuid) return null;
	const endpoint = e.kind === "document" ? str(e.endpoint) : EVIDENCE_ENDPOINTS[e.kind];
	return endpoint ? { endpoint, uuid } : null;
}

/** Подпись доказательства: что написало правило; у посещаемости — дата, у чек-листа — ещё и пункт. */
export function evidenceLabel(e: EvidenceRow): string {
	const label = str(e.label);
	if (e.kind === "attendance") return getFormatDateOnly(str(e.date)) || label;
	if (e.kind === "checklist" && str(e.itemText)) return label ? `${label} — ${str(e.itemText)}` : str(e.itemText);
	if (label) return label;
	return str(e.checkCode) || str(e.uuid).slice(0, 8);
}

/** Участок (если нарушение не про конкретного клиента): при ручном заведении кладётся в доказательства. */
export function violationArea(evidence: EvidenceRow[] | null | undefined): string {
	return str((evidence ?? []).find((e) => e.kind === "area")?.label);
}

/** Доказательства без «участка»: он показан отдельным полем рядом с клиентом. */
export function evidenceList(evidence: EvidenceRow[] | null | undefined): EvidenceRow[] {
	return (Array.isArray(evidence) ? evidence : []).filter((e) => e && e.kind !== "area");
}

// ── История решений ──────────────────────────────────────────────────────────

export interface HistoryEntry {
	key: "created" | "decided" | "disputed" | "resolved";
	at: string | null;
	/** Ключ перевода: что произошло. */
	textKey: string;
	actor: string | null;
	note: string | null;
}

type HistorySource = Pick<Violation,
	"source" | "status" | "selfDetected" | "detectedAt" | "createdByName" | "decidedAt" | "decidedByName" | "decisionNote"
	| "disputedAt" | "disputeText" | "disputeDecision" | "disputeDecidedByName" | "userName"> & { disputeDecidedAt?: string | null };

/**
 * История записи из её полей: заведена → решение → возражение → решение по возражению.
 *
 * Сервер хранит последнее решение, а не журнал: если подтверждённое потом отклонили, в записи
 * остаётся только отклонение (полный след — в журнале действий). Первое решение перед
 * возражением — всегда «подтверждено»: оспорить можно только подтверждённое.
 */
export function buildHistory(v: HistorySource): HistoryEntry[] {
	const out: HistoryEntry[] = [{
		key: "created",
		at: v.detectedAt ?? null,
		textKey: isRuleSource(v.source) ? "violationHistoryCreatedRule" : "violationHistoryCreatedManual",
		actor: v.createdByName ?? null,
		note: null,
	}];
	if (v.decidedAt) {
		const first = v.disputedAt ? "confirmed" : v.status === "confirmed" || v.status === "rejected" ? v.status : null;
		if (first) {
			out.push({
				key: "decided",
				at: v.decidedAt,
				textKey: first === "rejected" ? "violationHistoryRejected" : v.selfDetected ? "violationHistorySelfDetected" : "violationHistoryConfirmed",
				actor: v.decidedByName ?? null,
				note: v.decisionNote ?? null,
			});
		}
	}
	if (v.disputedAt) {
		out.push({ key: "disputed", at: v.disputedAt, textKey: "violationHistoryDisputed", actor: v.userName ?? null, note: v.disputeText ?? null });
	}
	if (v.disputeDecidedAt || v.disputeDecision) {
		out.push({
			key: "resolved",
			at: v.disputeDecidedAt ?? null,
			// Возражение принято — нарушение снято (rejected); отклонено — нарушение остаётся.
			textKey: v.status === "rejected" ? "violationHistoryDisputeAccepted" : "violationHistoryDisputeDeclined",
			actor: v.disputeDecidedByName ?? null,
			note: v.disputeDecision ?? null,
		});
	}
	return out;
}

// ── Действия и проверки ──────────────────────────────────────────────────────

export interface ViolationActions {
	confirm: boolean;
	reject: boolean;
	dispute: boolean;
	resolve: boolean;
}

/**
 * Что можно сделать с записью. `canDecide`/`isMine` приходят с сервера в GET /:id.
 * Самовыявленную ошибку оспаривать незачем: нарушением она не считается и бонус не снимает.
 */
export function availableActions(v: Pick<Violation, "status" | "selfDetected" | "canDecide" | "isMine">): ViolationActions {
	const canDecide = !!v.canDecide;
	return {
		confirm: canDecide && v.status === "candidate",
		reject: canDecide && (v.status === "candidate" || v.status === "confirmed"),
		dispute: !!v.isMine && v.status === "confirmed" && !v.selfDetected,
		resolve: canDecide && v.status === "disputed",
	};
}

export const MIN_DESCRIPTION = 10;
export const MIN_NOTE = 5;
export const MIN_DISPUTE = 10;

export interface SelfDetectedInfo {
	/** Найдена при самопроверке. */
	foundBySelfCheck: boolean;
	/** Своевременно исправлена. */
	fixedInTime: boolean;
	/** При необходимости сообщено руководителю — «при необходимости», поэтому не обязательно. */
	reported: boolean;
	/** Не повлекла последствий для клиента, учёта или отчётности. */
	noConsequences: boolean;
}

export const EMPTY_SELF_DETECTED: SelfDetectedInfo = { foundBySelfCheck: false, fixedInTime: false, reported: false, noConsequences: false };

/**
 * «Самовыявлено» по правилам применения бонуса: найдена при самопроверке, своевременно
 * исправлена и без последствий. Сообщение руководителю — «при необходимости».
 * Возвращает ключ ошибки или null.
 */
export function validateConfirm(selfDetected: boolean, info: SelfDetectedInfo): string | null {
	if (!selfDetected) return null;
	return info.foundBySelfCheck && info.fixedInTime && info.noConsequences ? null : "violationSelfDetectedConditions";
}

export function validateReject(note: string): string | null {
	return note.trim().length < MIN_NOTE ? "violationRejectReasonRequired" : null;
}

export function validateDispute(text: string): string | null {
	return text.trim().length < MIN_DISPUTE ? "violationDisputeTextRequired" : null;
}

export function validateResolve(decision: string, note: string): string | null {
	if (decision !== "confirmed" && decision !== "rejected") return "violationResolveDecisionRequired";
	return note.trim().length < MIN_NOTE ? "violationResolveNoteRequired" : null;
}

// ── Ручное заведение ─────────────────────────────────────────────────────────

export interface NewViolationFields {
	userUuid: string;
	itemNumber: string;
	/** Дата факта «ГГГГ-ММ-ДД». */
	occurredAt: string;
	clientOrganizationUuid: string;
	area: string;
	description: string;
	status: string;
}

/**
 * Каких фактов не хватает: правила применения бонуса требуют дату, сотрудника, клиента или
 * участок, суть и пункт стандарта. Возвращает ключи подписей недостающих полей.
 */
export function missingViolationFacts(f: NewViolationFields): string[] {
	const missing: string[] = [];
	if (!f.userUuid) missing.push("violationFieldEmployee");
	if (!(Number(f.itemNumber) > 0)) missing.push("violationFieldItem");
	if (!f.occurredAt) missing.push("violationFieldOccurredAt");
	if (!f.clientOrganizationUuid && !f.area.trim()) missing.push("violationFieldClientOrArea");
	if (f.description.trim().length < MIN_DESCRIPTION) missing.push("violationFieldDescription");
	return missing;
}

/** Дата факта позже сегодняшней (обе — «ГГГГ-ММ-ДД», сравнение строк корректно). */
export function isFutureDate(ymd: string, today: string): boolean {
	return !!ymd && ymd.slice(0, 10) > today;
}

export function newViolationPayload(f: NewViolationFields): Record<string, unknown> {
	const area = f.area.trim();
	return {
		userUuid: f.userUuid,
		itemNumber: Number(f.itemNumber),
		occurredAt: f.occurredAt,
		clientOrganizationUuid: f.clientOrganizationUuid || null,
		...(area ? { area } : {}),
		description: f.description.trim(),
		status: f.status === "candidate" ? "candidate" : "confirmed",
	};
}

// ── Отбор списка ─────────────────────────────────────────────────────────────

/** Быстрый отбор: все видимые, «мои» или «решить» (кандидаты и возражения моих подчинённых). */
export type ViolationScope = "" | "mine" | "toDecide";

export function scopeQueryParams(scope: ViolationScope): Record<string, string> | undefined {
	if (scope === "mine") return { mine: "1" };
	if (scope === "toDecide") return { toDecide: "1" };
	return undefined;
}

export function listFilter(status: string, month: string): Record<string, string> | undefined {
	const f: Record<string, string> = {};
	if (isStatus(status)) f.status = status;
	if (/^\d{4}-\d{2}$/.test(month)) f.bonusMonth = month;
	return Object.keys(f).length ? f : undefined;
}
