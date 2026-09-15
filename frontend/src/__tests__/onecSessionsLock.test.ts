/**
 * Блокировка начала сеансов видна — меткой и одной кнопкой по состоянию (P1).
 *
 * Сверка 14.09: «Закрыть вход» отвечало тостом, а включена ли блокировка, панель не знала —
 * обе кнопки стояли всегда. Теперь состояние хранит реестр, и метка говорит, откуда оно известно.
 */
import { describe, it, expect } from "vitest";
import { sessionsLockView } from "src/models/OneCAdmin/sessionsLock";
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
