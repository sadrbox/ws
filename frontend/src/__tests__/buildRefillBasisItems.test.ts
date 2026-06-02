import { describe, it, expect } from "vitest";
import { buildRefillBasisItems, mapItemsForBasis } from "src/utils/createFromBasis";

// Хелпер: «строка основания» как приходит с сервера (с собственным uuid).
function basisSrc(uuid: string, over: Partial<Record<string, unknown>> = {}) {
	return {
		uuid,
		productUuid: `prod-${uuid}`,
		quantity: 10,
		price: 100,
		vatRate: 12,
		exciseRate: 0,
		discountPercent: 0,
		...over,
	};
}

// Серверная строка документа-приёмника (реальный uuid + сохранённый sourceRowId).
function serverRow(uuid: string, sourceRowId: string, over: Partial<Record<string, unknown>> = {}) {
	return {
		id: 100,
		uuid,
		sourceRowId,
		productUuid: `prod-${sourceRowId}`,
		quantity: 10,
		price: 100,
		vatRate: 12,
		exciseRate: 0,
		discountPercent: 0,
		...over,
	};
}

describe("buildRefillBasisItems — идемпотентный refill по sourceRowId", () => {
	it("новый документ: первый refill добавляет все строки основания как create", () => {
		const basisRows = mapItemsForBasis([basisSrc("a"), basisSrc("b")]);
		const merged = buildRefillBasisItems([], basisRows);
		expect(merged).toHaveLength(2);
		expect(merged.every((r) => r._pendingAction === "create")).toBe(true);
		expect(merged.map((r) => r.sourceRowId)).toEqual(["a", "b"]);
	});

	it("повторный refill без изменений НЕ создаёт дублей (возвращает [])", () => {
		const basisRows1 = mapItemsForBasis([basisSrc("a"), basisSrc("b")]);
		// Симулируем, что строки уже в таблице как несохранённые черновики.
		const displayed = basisRows1.map((r) => ({ ...r }));
		// Второй refill — основание не изменилось (новые tmp uuid, тот же sourceRowId).
		const basisRows2 = mapItemsForBasis([basisSrc("a"), basisSrc("b")]);
		const merged = buildRefillBasisItems(displayed, basisRows2);
		expect(merged).toEqual([]); // нечего менять → без remount/дублей
	});

	it("изменение количества в основании → update серверной строки (тот же uuid)", () => {
		const displayed = [serverRow("srv-a", "a"), serverRow("srv-b", "b")];
		const basisRows = mapItemsForBasis([basisSrc("a", { quantity: 25 }), basisSrc("b")]);
		const merged = buildRefillBasisItems(displayed, basisRows);
		// b не изменилась → не трогаем; a изменилась → update с сохранением uuid.
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ uuid: "srv-a", _pendingAction: "update", quantity: 25 });
	});

	it("строка убрана из основания → delete серверной строки", () => {
		const displayed = [serverRow("srv-a", "a"), serverRow("srv-b", "b")];
		const basisRows = mapItemsForBasis([basisSrc("a")]); // b удалена из основания
		const merged = buildRefillBasisItems(displayed, basisRows);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ uuid: "srv-b", _pendingAction: "delete" });
	});

	it("лишняя серверная строка (нет в основании) → delete (приводим к основанию)", () => {
		// Ручная/лишняя строка с товаром, которого нет в основании.
		const extra = serverRow("srv-extra", "", { sourceRowId: null, productUuid: "prod-extra" });
		const displayed = [serverRow("srv-a", "a"), extra];
		const basisRows = mapItemsForBasis([basisSrc("a", { quantity: 99 })]);
		const merged = buildRefillBasisItems(displayed, basisRows);
		expect(merged).toContainEqual(
			expect.objectContaining({ uuid: "srv-a", _pendingAction: "update", quantity: 99 }),
		);
		expect(merged).toContainEqual(
			expect.objectContaining({ uuid: "srv-extra", _pendingAction: "delete" }),
		);
	});

	it("легаси-строки без sourceRowId усыновляются по товару (без дублей)", () => {
		// Документ создан до Этапа A: строки без sourceRowId, но соответствуют основанию.
		const displayed = [
			serverRow("srv-a", "", { sourceRowId: null, productUuid: "prod-a" }),
			serverRow("srv-b", "", { sourceRowId: null, productUuid: "prod-b" }),
		];
		const basisRows = mapItemsForBasis([basisSrc("a", { quantity: 7 }), basisSrc("b")]);
		const merged = buildRefillBasisItems(displayed, basisRows);
		// Обе строки усыновлены по товару → update с проставлением sourceRowId, без create-дублей.
		expect(merged.every((r) => r._pendingAction === "update")).toBe(true);
		expect(merged.some((r) => r._pendingAction === "create")).toBe(false);
		expect(merged).toContainEqual(
			expect.objectContaining({ uuid: "srv-a", sourceRowId: "a", quantity: 7 }),
		);
		expect(merged).toContainEqual(
			expect.objectContaining({ uuid: "srv-b", sourceRowId: "b" }),
		);
	});

	it("новая строка добавлена в основание → create, существующие не дублируются", () => {
		const displayed = [serverRow("srv-a", "a")];
		const basisRows = mapItemsForBasis([basisSrc("a"), basisSrc("c")]);
		const merged = buildRefillBasisItems(displayed, basisRows);
		// a без изменений → пропущена; c новая → create.
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ sourceRowId: "c", _pendingAction: "create" });
	});
});
