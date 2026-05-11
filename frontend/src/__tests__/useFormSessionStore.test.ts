/**
 * Тесты для src/hooks/useFormSessionStore.ts
 *
 * Проверяем:
 * 1. hadStoredData = false когда localStorage пуст (новая форма)
 * 2. hadStoredData = false когда в localStorage лежат ИДЕНТИЧНЫЕ по содержимому данные
 *    (ключевое исправление: ранее давало true из-за сравнения по ссылке)
 * 3. hadStoredData = true когда данные в localStorage реально отличаются
 * 4. Данные сохраняются в localStorage после setData
 * 5. clearStorage удаляет запись из localStorage
 * 6. clearAllFormStores очищает все записи текущего пользователя с префиксом formStore:<userId>:
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	useFormSessionStore,
	clearAllFormStores,
} from "src/hooks/useFormSessionStore";
import { AUTH_USER_KEY } from "src/services/auth";

const USER_ID = "test-user-uuid";
const FORM = "test-form";
const ID = "entity-123";
const KEY = `formStore:${USER_ID}:${FORM}:${ID}`;

const INITIAL = { name: "", age: 0, active: false };

beforeEach(() => {
	localStorage.clear();
	// Имитируем авторизованного пользователя — userId используется в ключе хранилища
	localStorage.setItem(
		AUTH_USER_KEY,
		JSON.stringify({ uuid: USER_ID, username: "tester" }),
	);
});

afterEach(() => {
	clearAllFormStores();
	localStorage.clear();
});

// ── Вспомогательная функция: записать в localStorage напрямую (имитация F5) ──
function seedStorage(value: object) {
	localStorage.setItem(KEY, JSON.stringify(value));
}

// ── Тесты ─────────────────────────────────────────────────────────────────────

describe("useFormSessionStore — hadStoredData", () => {
	it("false когда localStorage пуст (первый старт формы)", () => {
		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		const [, , , hadStoredData] = result.current;
		expect(hadStoredData).toBe(false);
	});

	it("false когда в localStorage лежат данные, идентичные initialValue (форма открыта, не изменена, страница обновлена)", () => {
		seedStorage(INITIAL);

		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		const [, , , hadStoredData] = result.current;
		expect(hadStoredData).toBe(false);
	});

	it("true когда данные в localStorage отличаются от initialValue (были реальные правки)", () => {
		const modified = { name: "Иван", age: 30, active: true };
		seedStorage(modified);

		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		const [, , , hadStoredData] = result.current;
		expect(hadStoredData).toBe(true);
	});

	it("false при частичном совпадении — только одно поле отличается", () => {
		seedStorage({ ...INITIAL });
		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		expect(result.current[3]).toBe(false);
	});

	it("true если хотя бы одно поле отличается от initialValue", () => {
		seedStorage({ ...INITIAL, name: "Changed" });
		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		expect(result.current[3]).toBe(true);
	});
});

describe("useFormSessionStore — чтение и запись", () => {
	it("возвращает initialValue при отсутствии данных в localStorage", () => {
		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		expect(result.current[0]).toEqual(INITIAL);
	});

	it("восстанавливает значение из localStorage при монтировании", () => {
		const stored = { name: "Петр", age: 25, active: true };
		seedStorage(stored);

		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		expect(result.current[0]).toEqual(stored);
	});

	it("setData обновляет значение и сохраняет в localStorage", () => {
		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		const [, setData] = result.current;

		act(() => {
			setData({ name: "Новое", age: 10, active: true });
		});

		expect(result.current[0]).toEqual({ name: "Новое", age: 10, active: true });
		const raw = localStorage.getItem(KEY);
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw!)).toEqual({ name: "Новое", age: 10, active: true });
	});

	it("setData с функцией-updater обновляет значение на основе предыдущего", () => {
		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));

		act(() => {
			result.current[1]((prev) => ({ ...prev, age: 99 }));
		});

		expect(result.current[0].age).toBe(99);
	});
});

describe("useFormSessionStore — clearStorage", () => {
	it("удаляет запись из localStorage", () => {
		seedStorage({ name: "Тест", age: 1, active: false });

		const { result } = renderHook(() => useFormSessionStore(FORM, ID, INITIAL));
		const [, , clearStorage] = result.current;

		act(() => clearStorage());

		expect(localStorage.getItem(KEY)).toBeNull();
	});
});

describe("clearAllFormStores", () => {
	it("удаляет все записи текущего пользователя с префиксом formStore:<userId>:", () => {
		localStorage.setItem(`formStore:${USER_ID}:form-a:1`, "{}");
		localStorage.setItem(`formStore:${USER_ID}:form-b:2`, "{}");
		// Черновик другого пользователя не должен быть удалён
		localStorage.setItem("formStore:other-user:form-c:3", "{}");
		localStorage.setItem("other-key", "keep-me");

		clearAllFormStores();

		expect(localStorage.getItem(`formStore:${USER_ID}:form-a:1`)).toBeNull();
		expect(localStorage.getItem(`formStore:${USER_ID}:form-b:2`)).toBeNull();
		// черновики другого пользователя не трогаем
		expect(localStorage.getItem("formStore:other-user:form-c:3")).toBe("{}");
		// не-formStore ключи не трогает
		expect(localStorage.getItem("other-key")).toBe("keep-me");
	});
});
