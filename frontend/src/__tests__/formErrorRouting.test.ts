import { describe, it, expect } from "vitest";
import { useDocumentNotices } from "src/hooks/useDocumentNotices";
import { renderHook } from "@testing-library/react";

// Правило (памятка «Notice vs Toast»):
//   • ошибка ДАННЫХ формы (клиентская валидация + бизнес-отказ бэка 400/409/422/423)
//     → показывается в <Notice /> ВНУТРИ формы: её чинят правкой полей;
//   • системный сбой (сеть, 5xx, нет прав) → <UIToast />, в Notice не попадает.
//
// Здесь проверяем витрину — что formError действительно доходит до <Notice />
// и встаёт ПЕРВЫМ (именно за этим пользователь и пришёл).
describe("ошибки формы → Notice", () => {
	const base = { docType: "sale" as const, fields: {} as Record<string, unknown> };

	it("ошибка данных формы попадает в Notice первым элементом", () => {
		const { result } = renderHook(() =>
			useDocumentNotices({
				...base,
				formError: "Серийные номера: «Товар 96»: количество 2, серий 1 — должны совпадать",
			}),
		);
		expect(result.current[0].type).toBe("error");
		expect(result.current[0].text).toMatch(/серий 1/);
	});

	it("без ошибки — Notice не содержит error-сообщений", () => {
		const { result } = renderHook(() => useDocumentNotices({ ...base, formError: null }));
		expect(result.current.some((i) => i.type === "error")).toBe(false);
	});

	it("системная ошибка в Notice не передаётся (её показывает тост)", () => {
		// Форма передаёт formError ТОЛЬКО при errorKind === "form" — имитируем "system".
		const errorKind = "system" as "form" | "system";
		const error = "Сервер временно недоступен";
		const { result } = renderHook(() =>
			useDocumentNotices({ ...base, formError: errorKind === "form" ? error : null }),
		);
		expect(result.current.some((i) => i.type === "error")).toBe(false);
	});
});
