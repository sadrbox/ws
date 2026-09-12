/**
 * Перечитывание после работы: второй проход — только для старого агента.
 *
 * Раньше панель перечитывала кэш ДВАЖДЫ с паузой 5 с, потому что свежее содержимое базы
 * ехало ВТОРОЙ командой (`REFRESH_AFTER` в сервисе): в момент «команда выполнена» реестр
 * ещё не был обновлён. Агент со способностью `ib.echo` приносит новый список своим же
 * ответом, и сервис кладёт его в реестр до того, как команда станет `done`, — ждать нечего
 * (docs/TASK_FRESH_STATE_AFTER_COMMAND.md).
 *
 * Проверяем ровно это: с эхом повтора нет, без эха он остаётся. Совместимость со старым
 * агентом здесь не мелочь: без повтора он показывал бы старое значение как новое.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { queryClient } from "src/app/queryClient";
import { refreshAfterWork } from "src/models/OneCAdmin/progress";

const agent = (capabilities: string[]) => ({
	items: [{ agentId: "a1", role: "admin", online: true, disabled: false, capabilities }],
});

/*
 * ТИП ПОДМЕНЫ — ОТ САМОГО МЕТОДА, а не `ReturnType<typeof vi.spyOn>`: у перегруженного
 * `spyOn` тот выводится в `any`, и дальше всё, к чему прикасается подмена, становится
 * небезопасным — линтер отвечал на это семью ошибками подряд. `MockInstance<typeof …>`
 * берёт сигнатуру у метода, который подменяем, и аргументы вызовов остаются типизированными.
 */
type InvalidateSpy = MockInstance<typeof queryClient.invalidateQueries>;

/** Сколько раз сбросили ключ списка баз — по нему и видно число проходов. */
const countBasesInvalidations = (spy: InvalidateSpy): number =>
	spy.mock.calls.filter(([filters]) => {
		// Ключ запроса — массив неизвестных значений: сравниваем с ожидаемыми, не приводя.
		const key = filters?.queryKey as unknown[] | undefined;
		return !!key && key[0] === "onec" && key[1] === "bases";
	}).length;

describe("refreshAfterWork", () => {
	let spy: InvalidateSpy;

	beforeEach(() => {
		vi.useFakeTimers();
		spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
	});
	afterEach(() => {
		spy.mockRestore();
		queryClient.removeQueries({ queryKey: ["onec", "agents"] });
		vi.useRealTimers();
	});

	it("агент с ib.echo — один проход, без пятисекундной паузы", () => {
		queryClient.setQueryData(["onec", "agents"], agent(["ib.admin", "ib.echo"]));
		refreshAfterWork();
		expect(countBasesInvalidations(spy)).toBe(1);

		vi.advanceTimersByTime(10_000);
		expect(countBasesInvalidations(spy)).toBe(1);
	});

	it("агент без ib.echo — запоздалый повтор остаётся", () => {
		queryClient.setQueryData(["onec", "agents"], agent(["ib.admin"]));
		refreshAfterWork();
		expect(countBasesInvalidations(spy)).toBe(1);

		vi.advanceTimersByTime(5_000);
		expect(countBasesInvalidations(spy)).toBe(2);
	});

	it("список агентов ещё не прочитан — ведём себя как со старым агентом", () => {
		refreshAfterWork();
		vi.advanceTimersByTime(5_000);
		expect(countBasesInvalidations(spy)).toBe(2);
	});
});
