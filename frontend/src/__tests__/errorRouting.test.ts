/**
 * Куда уходит ошибка: отказ по существу — форме, системный сбой — тостом и в журнал.
 *
 * ЗАЧЕМ ТЕСТ. Правило «Notice vs Toast» было памяткой и исполнялось руками: семнадцать
 * обработчиков звали тост, и НИ ОДИН не отличал «сначала отключите агента» (409) от обрыва
 * связи. Теперь решение принимает одна функция — и её таблицу статусов держит этот тест,
 * иначе граница снова разъедется по месту вызова.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { translate } from "src/i18";
import { errorStatus, errorText, isSystemError, routeError } from "src/services/errors/route";
import { APP_SCOPE, clearNoticeHistory, getMessages } from "src/components/TechMessages/store";

const toasts: string[] = [];
vi.mock("src/components/UIToast", () => ({
	showToast: (message: string) => { toasts.push(message); },
}));

/** Ошибка axios-подобная: статус лежит в response. */
const http = (status: number, message = "отказ") =>
	({ response: { status, data: { message } }, message: "network-ish" });

describe("маршрутизация ошибок: канал по вопросу, а не по важности", () => {
	beforeEach(() => {
		toasts.length = 0;
		clearNoticeHistory(APP_SCOPE);
		getMessages().length = 0;
	});

	it("отказ по существу возвращается ФОРМЕ и не мигает тостом", () => {
		// 409 «сначала отключите агента», 422 «серий меньше количества», 423 «период закрыт».
		for (const status of [400, 409, 422, 423]) {
			const own = routeError(http(status, `отказ ${status}`));
			expect(own).toHaveLength(1);
			expect(own[0].text).toBe(`отказ ${status}`);
		}
		expect(toasts).toHaveLength(0);
	});

	it("системный сбой показывается тостом И остаётся в журнале", () => {
		const own = routeError(http(500, "сервер сломался"), { source: "Реализация" });
		// Форме показывать нечего: сбой не про её поля.
		expect(own).toHaveLength(0);
		expect(toasts).toEqual(["сервер сломался"]);
		// Тост живёт секунды — вопрос «что это было» возникает позже, и ответ остаётся.
		expect(getMessages().map((m) => m.text)).toEqual(["сервер сломался"]);
		expect(getMessages()[0].source).toBe("Реализация");
	});

	it("нет ответа вовсе (сеть) — это системное, и сказано об этом по-человечески", () => {
		routeError(new Error("Network Error"));
		/*
		 * «Network Error» и «Failed to fetch» — слова браузера, а не ответ человеку: по ним
		 * не понять ни что случилось, ни что делать. Подменяем только такие, заведомо не
		 * предметные: отказ сервиса («сначала отключите агента») приходит уже написанным
		 * для человека и передаётся дословно — см. соседние проверки.
		 */
		expect(toasts).toEqual([translate("netNoConnection")]);
	});

	it("403 системное, хотя формально 4xx: правкой полей его не исправить", () => {
		expect(isSystemError(403)).toBe(true);
		expect(isSystemError(409)).toBe(false);
		expect(isSystemError(429)).toBe(true);
		expect(isSystemError(408)).toBe(true);
		expect(isSystemError(undefined)).toBe(true);
	});

	it("«Request failed with status code» уступает переведённому запасному тексту", () => {
		// Сервер отказал без объяснения — слова axios человеку не говорят ничего.
		const bare = { response: { status: 500, data: {} }, message: "Request failed with status code 500" };
		expect(errorText(bare, "Не удалось загрузить список файлов")).toBe("Не удалось загрузить список файлов");
		// Настоящее сообщение исключения по-прежнему важнее запасного.
		expect(errorText(new Error("база заблокирована"), "запасной")).toBe("база заблокирована");
	});

	it("403 от apiClient не дублируется: его уже показал перехватчик", () => {
		const own = routeError(http(403, "недостаточно прав"));
		expect(own).toHaveLength(0);
		expect(toasts).toHaveLength(0);
		expect(getMessages()).toHaveLength(0);
	});

	it("403 от сервиса мимо перехватчика показывается здесь", () => {
		routeError({ status: 403, message: "нет прав на базу" });
		expect(toasts).toEqual(["нет прав на базу"]);
		expect(getMessages().map((m) => m.text)).toEqual(["нет прав на базу"]);
	});

	it("статус и текст достаются из любой формы ошибки", () => {
		expect(errorStatus(http(422))).toBe(422);
		expect(errorStatus({ status: 409 })).toBe(409);
		expect(errorStatus({ statusCode: 500 })).toBe(500);
		expect(errorStatus(new Error("нет статуса"))).toBeUndefined();

		// Сообщение сервера важнее собственного текста исключения: оно написано человеку.
		expect(errorText(http(422, "серий меньше количества"))).toBe("серий меньше количества");
		expect(errorText(new Error("что-то пошло не так"))).toBe("что-то пошло не так");
		expect(errorText({}, "запасной")).toBe("запасной");
	});
});
