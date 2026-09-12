/**
 * Блокировка карточки выполняющейся операцией — и выход из неё.
 *
 * ЗАЧЕМ БЛОКИРОВКА. Пока команда меняет пользователя в базе, писать поверх его значений
 * нельзя: форма отправила бы команду по данным, которых уже нет.
 *
 * ЗАЧЕМ ПРЕДЕЛ. Запись операции живёт в браузере, а её судьбу решает задание на сервере.
 * Если задание перестало отвечать — команду не поставили вовсе, сервис перезапустили —
 * запись остаётся «выполняющейся» навсегда, и карточка заперта навсегда. Живой случай
 * 12.09: команда по базе выполнена в 18:50, а форма в 19:30 всё ещё писала «идёт операция».
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
	abandonOp, clearFinished, finishOp, opBlocks, startOp, useOnecOps,
} from "src/models/OneCAdmin/progress";
import { renderHook, act } from "@testing-library/react";

const op = (over: Partial<Parameters<typeof opBlocks>[0]> = {}) => ({
	id: "op1", kind: "update" as const, title: "Изменить пользователя", target: "Оператор",
	total: 1, done: 0, failed: 0, state: "running" as const,
	startedAt: Date.now(), finishedAt: null, batchId: "b1", cancelable: 0, note: "",
	scope: { user: "Оператор", bases: ["_transition"] },
	...over,
});

describe("операция запирает карточку — но не навсегда", () => {
	it("свежая операция по этой паре «человек + база» блокирует правку", () => {
		expect(opBlocks(op(), "Оператор", "_transition")).toBe(true);
	});

	it("чужой человек и чужая база не блокируются", () => {
		expect(opBlocks(op(), "Кассир", "_transition")).toBe(false);
		expect(opBlocks(op(), "Оператор", "akacapital")).toBe(false);
	});

	it("завершённая операция не блокирует", () => {
		expect(opBlocks(op({ state: "done" }), "Оператор", "_transition")).toBe(false);
	});

	it("«выполняется» дольше получаса перестаёт запирать форму", () => {
		// Ни одно чтение или запись в базу столько не длится (самая долгая измеренная — 34 с).
		// Держать форму запертой из-за записи, которая уже ничем не управляет, — хуже.
		const stuck = op({ startedAt: Date.now() - 31 * 60_000 });
		expect(opBlocks(stuck, "Оператор", "_transition")).toBe(false);
	});
});

describe("прекратить наблюдение", () => {
	beforeEach(() => { clearFinished(); });

	it("убирает запись, не трогая команду на сервере", () => {
		const { result } = renderHook(() => useOnecOps());
		let id = "";
		act(() => { id = startOp({ kind: "update", title: "Изменить пользователя", target: "Оператор", total: 1 }); });
		expect(result.current.some((o) => o.id === id)).toBe(true);

		// Отмена и прекращение наблюдения — разные действия: первое останавливает команду,
		// второе лишь убирает запись с экрана. Здесь — второе.
		act(() => { abandonOp(id); });
		expect(result.current.some((o) => o.id === id)).toBe(false);
	});

	it("«очистить завершённые» выполняющиеся не трогает", () => {
		const { result } = renderHook(() => useOnecOps());
		let running = ""; let done = "";
		act(() => {
			running = startOp({ kind: "update", title: "Идёт", target: "a", total: 1 });
			done = startOp({ kind: "update", title: "Кончилась", target: "b", total: 1 });
			finishOp(done);
		});
		act(() => { clearFinished(); });
		expect(result.current.map((o) => o.id)).toEqual([running]);
	});
});
