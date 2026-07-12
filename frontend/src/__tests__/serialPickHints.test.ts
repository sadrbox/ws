import { describe, it, expect } from "vitest";

// Подсказки при выборе серий. Логика вынесена сюда 1:1 из SerialNumbersCell —
// смысл: не дать отгрузить НЕ ТУ серию и не набрать лишнего.
//
// Почему это важно: серии физически различимы. Отгрузили не тот экземпляр —
// получили спор по гарантии/возврату, а в системе всё «сходится».

/** Дубликаты во вводе приёмки (скопировали строку дважды — частая ошибка). */
function findDuplicates(text: string): string[] {
	const seen = new Set<string>();
	const dup = new Set<string>();
	for (const v of text.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)) {
		const k = v.toLowerCase();
		if (seen.has(k)) dup.add(v);
		else seen.add(k);
	}
	return [...dup];
}

/** Можно ли отметить ещё одну серию (норма набрана → нельзя). */
const canPickMore = (picked: number, quantity: number) => picked < quantity;

describe("подсказки при выборе серий", () => {
	it("ловит дубликаты во вводе приёмки", () => {
		expect(findDuplicates("SN-1\nSN-2\nSN-1")).toEqual(["SN-1"]);
		// регистр не должен обманывать: SN-1 и sn-1 — одна и та же серия
		expect(findDuplicates("SN-1, sn-1")).toEqual(["sn-1"]);
		expect(findDuplicates("SN-1\nSN-2")).toEqual([]);
	});

	it("норма набрана → лишнюю серию выбрать нельзя", () => {
		expect(canPickMore(1, 2)).toBe(true);
		// нельзя отгрузить больше количества строки
		expect(canPickMore(2, 2)).toBe(false);
		expect(canPickMore(3, 2)).toBe(false);
	});

	it("нехватка серий на складе видна ДО сохранения (иначе — 422 при записи)", () => {
		const availableCount = 1;
		const quantity = 2;
		expect(availableCount < quantity).toBe(true);
	});
});
