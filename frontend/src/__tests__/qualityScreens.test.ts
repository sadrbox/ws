// E17: справочник пунктов стандарта, «Мои уведомления», «Проверка ответа клиенту».
import { describe, it, expect } from "vitest";
import { translate } from "src/i18";
import type { UserNotification } from "src/services/quality/api";
import {
	appliesToLabel, appliesToOptions, detectionKindLabel, detectionKindOptions, standardItemPayload,
} from "src/models/StandardItems/standardItems";
import { notificationTarget, sortNotifications, unreadCount } from "src/models/QualityNotifications/notifications";
import {
	CHECK_ORDER, MODEL_CHECK_ORDER, modelChecklist, modelErrorNotice, modelVerdictTone, reviewChecklist, scoreTone,
} from "src/models/ConsultationCheck/consultation";
import { AiServiceError } from "src/services/ai/endpoint";

describe("пункты стандарта", () => {
	it("кто может нарушить и как выявляется — значения сервера и их подписи", () => {
		expect(appliesToOptions().map((o) => o.value)).toEqual(["employee", "chief", "manager"]);
		expect(detectionKindOptions().map((o) => o.value)).toEqual(["auto", "signal", "manual"]);
		expect(appliesToLabel("chief")).toBe(translate("standardItemAppliesChief"));
		expect(detectionKindLabel("signal")).toBe(translate("standardItemKindSignal"));
		expect(appliesToLabel("owner")).toBe("owner");
		expect(detectionKindLabel(undefined)).toBe("");
	});

	it("правка пункта: формулировка и текст обязательны, прочие значения — только допустимые", () => {
		const f = { title: " Нарушение сроков ", text: " Текст ", isActive: false, appliesTo: "chief", kind: "auto" };
		expect(standardItemPayload(f)).toEqual({ payload: { title: "Нарушение сроков", text: "Текст", isActive: false, appliesTo: "chief", kind: "auto" } });
		expect(standardItemPayload({ ...f, title: " " })).toEqual({ error: "standardItemNeedTitle" });
		expect(standardItemPayload({ ...f, text: "" })).toEqual({ error: "standardItemNeedText" });
		expect(standardItemPayload({ ...f, appliesTo: "owner", kind: "magic" })).toEqual({ payload: { title: "Нарушение сроков", text: "Текст", isActive: false } });
	});
});

describe("мои уведомления", () => {
	const n = (uuid: string, createdAt: string, readAt: string | null, link: UserNotification["link"] = null): UserNotification =>
		({ uuid, kind: "violation", title: uuid, body: null, link, readAt, createdAt });

	it("непрочитанные сверху, внутри — новые первыми", () => {
		const sorted = sortNotifications([
			n("old-read", "2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z"),
			n("new-read", "2026-09-24T10:00:00Z", "2026-09-24T11:00:00Z"),
			n("old-unread", "2026-09-21T10:00:00Z", null),
			n("new-unread", "2026-09-25T10:00:00Z", null),
		]);
		expect(sorted.map((x) => x.uuid)).toEqual(["new-unread", "old-unread", "new-read", "old-read"]);
		expect(unreadCount(sorted)).toBe(2);
		expect(sortNotifications(undefined)).toEqual([]);
	});

	it("куда ведёт: запись по endpoint+uuid, панель по имени, иначе никуда", () => {
		expect(notificationTarget(n("a", "", null, { endpoint: "standard-violations", uuid: "v-1" })))
			.toEqual({ kind: "form", endpoint: "standard-violations", uuid: "v-1" });
		expect(notificationTarget(n("b", "", null, { pane: "QualityBonusView" }))).toEqual({ kind: "view", name: "QualityBonusView" });
		expect(notificationTarget(n("c", "", null, { endpoint: "todos" }))).toBeNull();
		expect(notificationTarget(n("d", "", null))).toBeNull();
	});
});

describe("проверка ответа клиенту", () => {
	it("пункты — в порядке стандарта, отметка по ответу сервера", () => {
		const rows = reviewChecklist({
			checks: { conclusion: true, recommendation: false, npa: true, actuality: false, length: true, notLawDump: true },
		});
		expect(rows.map((r) => r.key)).toEqual([...CHECK_ORDER]);
		expect(rows.filter((r) => !r.passed).map((r) => r.key)).toEqual(["recommendation", "actuality"]);
		expect(rows[0].labelKey).toBe("consultationCheckConclusion");
		expect(reviewChecklist(null)).toEqual([]);
	});

	it("тон оценки", () => {
		expect(scoreTone(100)).toBe("ok");
		expect(scoreTone(83)).toBe("warn");
		expect(scoreTone(67)).toBe("warn");
		expect(scoreTone(50)).toBe("bad");
	});
});

describe("проверка ответа моделью", () => {
	const check = (ok: boolean, note = "") => ({ ok, note });
	const review = {
		verdict: "needs_work" as const,
		score: 40,
		checks: {
			conclusion: check(true), recommendation: check(false, "Нет срока"), npa: { ...check(true), articles: ["ст. 412 НК РК"] },
			actuality: check(false, "Сверьте редакцию"), brevity: check(true), certainty: check(false, "«возможно»"),
		},
	};

	it("пункты модели — в своём порядке, с пояснением", () => {
		const rows = modelChecklist(review);
		expect(rows.map((r) => r.key)).toEqual([...MODEL_CHECK_ORDER]);
		expect(rows.filter((r) => !r.ok).map((r) => r.key)).toEqual(["recommendation", "actuality", "certainty"]);
		expect(rows.find((r) => r.key === "recommendation")?.note).toBe("Нет срока");
		expect(modelChecklist(null)).toEqual([]);
	});

	it("тон вердикта", () => {
		expect(modelVerdictTone({ verdict: "ok", score: 95 })).toBe("ok");
		expect(modelVerdictTone({ verdict: "needs_work", score: 70 })).toBe("warn");
		expect(modelVerdictTone(review)).toBe("bad");
		expect(modelVerdictTone(null)).toBe("muted");
	});

	it("отказы сервиса ИИ: не настроено — сведение, частые нажатия и сбои модели — повторить", () => {
		expect(modelErrorNotice(new AiServiceError("x", 503, "LLM_DISABLED"))).toEqual({ type: "info", key: "consultationModelDisabled" });
		expect(modelErrorNotice(new AiServiceError("x", 429, "RATE_LIMITED"))?.key).toBe("consultationModelRateLimited");
		expect(modelErrorNotice(new AiServiceError("x", 502, "LLM_BAD_OUTPUT"))?.key).toBe("consultationModelBadOutput");
		expect(modelErrorNotice(new AiServiceError("x", 504, "LLM_TIMEOUT"))?.key).toBe("consultationModelTimeout");
		expect(modelErrorNotice(new AiServiceError("x", 400, "VALIDATION_ERROR"))).toBeNull();
		expect(modelErrorNotice(new Error("сеть"))).toBeNull();
	});
});
