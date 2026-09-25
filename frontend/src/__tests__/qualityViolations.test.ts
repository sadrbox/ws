// E17 СК5: реестр нарушений — подписи статусов, доказательства, история решений, действия,
// проверки перед отправкой, отбор списка.
import { describe, it, expect } from "vitest";
import { translate } from "src/i18";
import type { EvidenceRow, Violation } from "src/services/quality/api";
import {
	VIOLATION_STATUSES, VIOLATION_STATUS_KEYS, availableActions, buildHistory, evidenceKindKey, evidenceLabel, evidenceList,
	evidenceTarget, isFutureDate, isRuleSource, itemCaption, listFilter, missingViolationFacts, newViolationPayload,
	scopeQueryParams, sourceKey, statusLabel, statusTone, validateConfirm, validateDispute, validateReject, validateResolve,
	violationArea, EMPTY_SELF_DETECTED, type NewViolationFields,
} from "src/models/StandardViolations/violations";

const base: Violation = {
	id: 7, uuid: "v-7", userUuid: "u-1", userName: "Иванова А.", clientOrganizationUuid: "o-1", clientName: "ТОО Клиент",
	itemNumber: 3, itemTitle: "Нет своевременной реакции", occurredAt: "2026-09-20T00:00:00.000Z", detectedAt: "2026-09-21T05:00:00.000Z",
	bonusMonth: "2026-09", description: "Обращение не принято в срок", evidence: null, source: "manual", status: "candidate",
	selfDetected: false, decidedByName: null, decidedAt: null, decisionNote: null, disputeText: null, disputedAt: null,
	disputeDecision: null, disputeDecidedByName: null, createdByName: "Главбух Б.",
};

describe("статусы", () => {
	it("подпись — по ключу перевода, неизвестный код — как есть", () => {
		for (const s of VIOLATION_STATUSES) expect(statusLabel(s)).toBe(translate(VIOLATION_STATUS_KEYS[s]));
		expect(statusLabel("archived")).toBe("archived");
		expect(statusLabel(null)).toBe("");
	});

	it("тон: подтверждено — плохо, кандидат — ждёт решения, возражение — на рассмотрении, отклонено — приглушено", () => {
		expect(statusTone("confirmed")).toBe("bad");
		expect(statusTone("candidate")).toBe("warn");
		expect(statusTone("disputed")).toBe("info");
		expect(statusTone("rejected")).toBe("muted");
		expect(statusTone("что-то")).toBe("muted");
	});

	it("источник: правило или вручную", () => {
		expect(isRuleSource("rule:sla_reaction")).toBe(true);
		expect(isRuleSource("manual")).toBe(false);
		expect(sourceKey("rule:x")).toBe("violationSourceRule");
		expect(sourceKey("manual")).toBe("violationSourceManual");
		expect(sourceKey(undefined)).toBe("violationSourceManual");
	});

	it("itemCaption: номер пункта и формулировка", () => {
		const short = translate("violationItemShort");
		expect(itemCaption(3, "Нет реакции")).toBe(`${short} 3 — Нет реакции`);
		expect(itemCaption("12")).toBe(`${short} 12`);
		expect(itemCaption(0)).toBe("");
		expect(itemCaption(undefined)).toBe("");
	});
});

describe("доказательства", () => {
	const todo: EvidenceRow = { kind: "todo", uuid: "t-1", label: "Сверка с ТОО" };
	const finding: EvidenceRow = { kind: "finding", uuid: "f-1", label: "Минус по складу", checkCode: "stock.negative" };
	const checklist: EvidenceRow = { kind: "checklist", uuid: "r-1", label: "Закрытие месяца", itemText: "Сверки закрыты" };
	const doc: EvidenceRow = { kind: "document", uuid: "d-1", endpoint: "sales", label: "Реализация № 5" };
	const area: EvidenceRow = { kind: "area", label: "Банк" };
	const attendance: EvidenceRow = { kind: "attendance", date: "2026-09-22" };

	it("куда ведёт: задача, находка, прогон чек-листа, документ по своему endpoint", () => {
		expect(evidenceTarget(todo)).toEqual({ endpoint: "todos", uuid: "t-1" });
		expect(evidenceTarget(finding)).toEqual({ endpoint: "check-findings", uuid: "f-1" });
		expect(evidenceTarget(checklist)).toEqual({ endpoint: "checklist-runs", uuid: "r-1" });
		expect(evidenceTarget(doc)).toEqual({ endpoint: "sales", uuid: "d-1" });
		expect(evidenceTarget(area)).toBeNull();
		expect(evidenceTarget(attendance)).toBeNull();
		expect(evidenceTarget({ kind: "document", uuid: "d-2" })).toBeNull();
		expect(evidenceTarget({ kind: "todo" })).toBeNull();
	});

	it("подписи и виды", () => {
		expect(evidenceLabel(todo)).toBe("Сверка с ТОО");
		expect(evidenceLabel(checklist)).toBe("Закрытие месяца — Сверки закрыты");
		expect(evidenceLabel(attendance)).toBe("22.09.2026");
		expect(evidenceLabel({ kind: "finding", uuid: "abcdef123456", checkCode: "docs.unposted" })).toBe("docs.unposted");
		expect(evidenceKindKey("todo")).toBe("violationEvidenceTodo");
		expect(evidenceKindKey("зачем")).toBe("violationEvidenceOther");
	});

	it("участок — отдельно, в списке доказательств его нет", () => {
		const ev = [todo, area, finding];
		expect(violationArea(ev)).toBe("Банк");
		expect(evidenceList(ev)).toEqual([todo, finding]);
		expect(violationArea(null)).toBe("");
		expect(evidenceList(null)).toEqual([]);
	});
});

describe("история решений", () => {
	it("кандидат от правила: только заведение", () => {
		const h = buildHistory({ ...base, source: "rule:sla_reaction", createdByName: null });
		expect(h.map((e) => e.textKey)).toEqual(["violationHistoryCreatedRule"]);
	});

	it("подтверждено, оспорено, возражение отклонено", () => {
		const h = buildHistory({
			...base, status: "confirmed", decidedAt: "2026-09-21T06:00:00Z", decidedByName: "Главбух Б.", decisionNote: "Факт есть",
			disputedAt: "2026-09-22T06:00:00Z", disputeText: "Клиент сам перенёс срок",
			disputeDecision: "Перенос не согласован", disputeDecidedByName: "Руководитель В.", disputeDecidedAt: "2026-09-23T06:00:00Z",
		});
		expect(h.map((e) => e.key)).toEqual(["created", "decided", "disputed", "resolved"]);
		expect(h[1]).toMatchObject({ textKey: "violationHistoryConfirmed", actor: "Главбух Б.", note: "Факт есть" });
		expect(h[2]).toMatchObject({ textKey: "violationHistoryDisputed", actor: "Иванова А.", note: "Клиент сам перенёс срок" });
		expect(h[3]).toMatchObject({ textKey: "violationHistoryDisputeDeclined", actor: "Руководитель В." });
	});

	it("возражение принято: нарушение снято, первое решение всё равно «подтверждено»", () => {
		const h = buildHistory({
			...base, status: "rejected", decidedAt: "2026-09-21T06:00:00Z", disputedAt: "2026-09-22T06:00:00Z",
			disputeText: "…", disputeDecision: "Согласен", disputeDecidedAt: "2026-09-23T06:00:00Z",
		});
		expect(h.find((e) => e.key === "decided")?.textKey).toBe("violationHistoryConfirmed");
		expect(h.find((e) => e.key === "resolved")?.textKey).toBe("violationHistoryDisputeAccepted");
	});

	it("самовыявлено и отклонено", () => {
		expect(buildHistory({ ...base, status: "confirmed", selfDetected: true, decidedAt: "2026-09-21T06:00:00Z" })[1].textKey)
			.toBe("violationHistorySelfDetected");
		expect(buildHistory({ ...base, status: "rejected", decidedAt: "2026-09-21T06:00:00Z", decisionNote: "Не наш клиент" })[1])
			.toMatchObject({ textKey: "violationHistoryRejected", note: "Не наш клиент" });
	});
});

describe("действия", () => {
	it("решающий: кандидата — подтвердить или отклонить; подтверждённое — отклонить; возражение — решить", () => {
		expect(availableActions({ status: "candidate", selfDetected: false, canDecide: true, isMine: false }))
			.toEqual({ confirm: true, reject: true, dispute: false, resolve: false });
		expect(availableActions({ status: "confirmed", selfDetected: false, canDecide: true, isMine: false }))
			.toEqual({ confirm: false, reject: true, dispute: false, resolve: false });
		expect(availableActions({ status: "disputed", selfDetected: false, canDecide: true, isMine: false }))
			.toEqual({ confirm: false, reject: false, dispute: false, resolve: true });
		expect(availableActions({ status: "rejected", selfDetected: false, canDecide: true, isMine: false }))
			.toEqual({ confirm: false, reject: false, dispute: false, resolve: false });
	});

	it("нарушитель: оспорить только подтверждённое и не самовыявленное; решать о себе не может", () => {
		expect(availableActions({ status: "confirmed", selfDetected: false, canDecide: false, isMine: true }).dispute).toBe(true);
		expect(availableActions({ status: "confirmed", selfDetected: true, canDecide: false, isMine: true }).dispute).toBe(false);
		expect(availableActions({ status: "candidate", selfDetected: false, canDecide: false, isMine: true }))
			.toEqual({ confirm: false, reject: false, dispute: false, resolve: false });
	});

	it("проверки перед отправкой — как у сервера", () => {
		expect(validateConfirm(false, EMPTY_SELF_DETECTED)).toBeNull();
		expect(validateConfirm(true, EMPTY_SELF_DETECTED)).toBe("violationSelfDetectedConditions");
		// «Сообщено руководителю» — «при необходимости», поэтому не обязательно.
		expect(validateConfirm(true, { foundBySelfCheck: true, fixedInTime: true, reported: false, noConsequences: true })).toBeNull();
		expect(validateConfirm(true, { foundBySelfCheck: true, fixedInTime: false, reported: true, noConsequences: true }))
			.toBe("violationSelfDetectedConditions");
		expect(validateReject(" нет ")).toBe("violationRejectReasonRequired");
		expect(validateReject("Не наш клиент")).toBeNull();
		expect(validateDispute("не так")).toBe("violationDisputeTextRequired");
		expect(validateDispute("Срок перенёс сам клиент письмом")).toBeNull();
		expect(validateResolve("", "Обоснование")).toBe("violationResolveDecisionRequired");
		expect(validateResolve("confirmed", "ок")).toBe("violationResolveNoteRequired");
		expect(validateResolve("rejected", "Согласен с доводами")).toBeNull();
	});
});

describe("ручное заведение", () => {
	const full: NewViolationFields = {
		userUuid: "u-1", itemNumber: "3", occurredAt: "2026-09-20", clientOrganizationUuid: "", area: " Банк ",
		description: "  Выписки не разнесены неделю  ", status: "confirmed",
	};

	it("факты обязательны: сотрудник, пункт, дата, клиент или участок, суть от 10 знаков", () => {
		expect(missingViolationFacts(full)).toEqual([]);
		expect(missingViolationFacts({ ...full, userUuid: "", itemNumber: "", occurredAt: "", area: "", description: "коротко" }))
			.toEqual(["violationFieldEmployee", "violationFieldItem", "violationFieldOccurredAt", "violationFieldClientOrArea", "violationFieldDescription"]);
		expect(missingViolationFacts({ ...full, area: "", clientOrganizationUuid: "o-1" })).toEqual([]);
	});

	it("дата факта не в будущем", () => {
		expect(isFutureDate("2026-09-26", "2026-09-25")).toBe(true);
		expect(isFutureDate("2026-09-25", "2026-09-25")).toBe(false);
		expect(isFutureDate("", "2026-09-25")).toBe(false);
	});

	it("тело запроса: число пункта, участок без пробелов, статус только из двух", () => {
		expect(newViolationPayload(full)).toEqual({
			userUuid: "u-1", itemNumber: 3, occurredAt: "2026-09-20", clientOrganizationUuid: null, area: "Банк",
			description: "Выписки не разнесены неделю", status: "confirmed",
		});
		const p = newViolationPayload({ ...full, area: "", clientOrganizationUuid: "o-1", status: "candidate" });
		expect(p).not.toHaveProperty("area");
		expect(p).toMatchObject({ clientOrganizationUuid: "o-1", status: "candidate" });
		expect(newViolationPayload({ ...full, status: "rejected" }).status).toBe("confirmed");
	});
});

describe("отбор списка", () => {
	it("«Мои» и «Решить» — параметры сервера", () => {
		expect(scopeQueryParams("")).toBeUndefined();
		expect(scopeQueryParams("mine")).toEqual({ mine: "1" });
		expect(scopeQueryParams("toDecide")).toEqual({ toDecide: "1" });
	});

	it("статус и месяц бонуса — фильтр списка; мусор не уходит на сервер", () => {
		expect(listFilter("", "")).toBeUndefined();
		expect(listFilter("confirmed", "2026-09")).toEqual({ status: "confirmed", bonusMonth: "2026-09" });
		expect(listFilter("archived", "сентябрь")).toBeUndefined();
	});
});
