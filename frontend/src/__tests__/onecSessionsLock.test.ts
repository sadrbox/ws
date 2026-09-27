/**
 * Блокировка начала сеансов видна — меткой и одной кнопкой по состоянию (P1).
 *
 * Сверка 14.09: «Закрыть вход» отвечало тостом, а включена ли блокировка, панель не знала —
 * обе кнопки стояли всегда. Теперь состояние хранит реестр, и метка говорит, откуда оно известно.
 */
import { describe, it, expect } from "vitest";
import { lockOutcome, sessionsLockView } from "src/models/OneCAdmin/sessionsLock";
import { translate } from "src/i18";

describe("состояние блокировки сеансов", () => {
	it("не проверялось — неизвестно, а не «открыт»", () => {
		const v = sessionsLockView({ sessionsDenied: null });
		expect(v.known).toBe(false);
		expect(v.label).toBe(translate("onecSessionsLockUnknown"));
	});

	it("закрыт — сообщение и окно в подробностях", () => {
		const v = sessionsLockView({
			sessionsDenied: true, sessionsDeniedMessage: "Обслуживание", sessionsDeniedFrom: "18:00", sessionsDeniedTo: "19:00",
			sessionsDeniedSource: "cluster",
		});
		expect(v).toMatchObject({ known: true, enabled: true, tone: "bad", label: translate("onecSessionsLockOn") });
		expect(v.details).toBe("Обслуживание. 18:00 — 19:00");
	});

	it("открыт по команде панели — сказано, что кластер не сообщил", () => {
		const v = sessionsLockView({ sessionsDenied: false, sessionsDeniedSource: "command" });
		expect(v).toMatchObject({ enabled: false, tone: "ok" });
		expect(v.details).toBe(translate("onecSessionsLockByCommand"));
	});

	it("включена, но не действует — не «закрыт»: окно прошлой блокировки оставило вход открытым", () => {
		const v = sessionsLockView({ sessionsDenied: true, sessionsDeniedActive: false, sessionsDeniedSource: "cluster" });
		expect(v).toMatchObject({ known: true, enabled: true, tone: "unknown", label: translate("onecSessionsLockInactive") });
		expect(v.details).toBe(translate("onecSessionsLockInactiveHint"));
	});

	it("код разрешения задан и время чтения у недействующей — в подробностях (П17)", () => {
		const v = sessionsLockView({
			sessionsDenied: true, sessionsDeniedActive: false, sessionsDeniedCodeSet: true,
			sessionsDeniedSeenAt: "2026-09-15T10:00:00Z", sessionsDeniedSource: "cluster",
		});
		expect(v.details).toContain(translate("onecSessionsLockCodeSet"));
		expect(v.details).toContain(translate("onecSessionsLockReadAt"));
	});
});

// И26: «Закрыть вход» — «Выполнено» только если вход реально закрыт (общий разбор для «Сеансов» и карточки базы).
describe("итог «Закрыть вход» по ответу", () => {
	it("закрыт и действует — успех", () => {
		expect(lockOutcome({ ok: true, state: { lock: { enabled: true, active: true } }, reset: "all" }, true))
			.toEqual({ tone: "success", text: translate("onecLockEnabled") });
	});

	it("включили, но не действует (окно прошлой блокировки) — предупреждение", () => {
		expect(lockOutcome({ ok: true, state: { lock: { enabled: true, active: false } } }, true))
			.toEqual({ tone: "warning", text: translate("onecLockNotActive") });
	});

	it("кластер не подтвердил запись — «не проверено»", () => {
		expect(lockOutcome({ ok: true, unverified: ["enabled"] }, true))
			.toEqual({ tone: "warning", text: translate("onecLockUnverified") });
	});

	it("прочитанное не то, что просили — «не применено»", () => {
		expect(lockOutcome({ ok: true, state: { lock: { enabled: false } } }, true))
			.toEqual({ tone: "warning", text: translate("onecLockNotApplied") });
	});

	it("предупреждение агента и неполный сброс — словами", () => {
		const out = lockOutcome({ ok: true, warning: "Осталось окно до 18:00", reset: "dates", note: "Сообщение осталось" }, true);
		expect(out).toEqual({ tone: "warning", text: "Осталось окно до 18:00. Сообщение осталось" });
	});

	it("открыли вход — успех", () => {
		expect(lockOutcome({ ok: true, state: { lock: { enabled: false } } }, false))
			.toEqual({ tone: "success", text: translate("onecLockDisabled") });
	});
});
