/**
 * Кто держит базу — строкой в тексте отказа (П25): «Фоновое задание» сразу говорит, что блокировка входа не поможет.
 */
import { describe, expect, it } from "vitest";
import { errorText } from "src/services/errors/route";
import { AiServiceError } from "src/services/ai/endpoint";
import { translate } from "src/i18";

describe("errorText: держатель базы", () => {
	it("поля держателя приписываются к тексту платформы", () => {
		const e = new AiServiceError("Ошибка разделенного доступа к базе данных", 422, "IB_ERROR", {
			lockedBy: { appId: "Фоновое задание", sessionId: "2", computer: "SERVER", startedAt: "16.09.2026 в 9:54:27" },
		}, true);
		const text = errorText(e);
		expect(text).toContain("Ошибка разделенного доступа");
		expect(text).toContain(translate("onecHeldBy"));
		expect(text).toContain("Фоновое задание");
		expect(text).toContain("SERVER");
	});

	it("подробностей нет — текст не меняется", () => {
		const e = new AiServiceError("Команда не выполнена", 422, "COMMAND_FAILED");
		expect(errorText(e)).toBe("Команда не выполнена");
	});

	it("признак повтора доезжает до панели", () => {
		const e = new AiServiceError("база занята", 422, "IB_BUSY", undefined, true);
		expect(e.retryable).toBe(true);
	});
});
