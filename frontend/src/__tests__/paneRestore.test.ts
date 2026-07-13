import { describe, it, expect } from "vitest";
import { inferListRestore } from "src/app/paneRestore";
import { VIEWS } from "src/registry/viewRegistry";

// Панель хранит ЖИВОЙ React-компонент — в localStorage его не положить. Поэтому
// сохраняем имя, а поднимаем панель через viewRegistry.
//
// Раньше рецепт проставляли только реестры, а навбар открывал панели напрямую
// (`addPane({ component: SalesList })`) — и после перезагрузки они исчезали.

const comp = (name: string) => Object.assign(() => null, { displayName: name });

describe("восстановление панелей после перезагрузки", () => {
	it("панель из навбара получает рецепт по имени компонента", () => {
		expect(inferListRestore(comp("SalesList") as never)).toEqual({ kind: "view", name: "SalesList" });
	});

	it("рецепт выводится для ВСЕХ панелей реестра — без исключений", () => {
		const missing = Object.keys(VIEWS).filter((name) => !inferListRestore(comp(name) as never));
		expect(missing).toEqual([]);
	});

	it("покрыты и панели вне modelRegistry (ЭСФ, СНТ, классификаторы)", () => {
		for (const name of ["EsfIncomingList", "SntOutboxList", "ClassifiersList"]) {
			expect(inferListRestore(comp(name) as never), name).toMatchObject({ kind: "view", name });
		}
	});

	it("формы-ОБРАБОТКИ из навбара восстанавливаются (записи у них нет — и не нужно)", () => {
		expect(inferListRestore(comp("OpeningBalanceForm") as never))
			.toEqual({ kind: "view", name: "OpeningBalanceForm" });
	});

	it("формы ЗАПИСЕЙ идут мимо: их рецепт (endpoint+uuid) ставит ModelList", () => {
		// SalesForm не в VIEWS — он открывается через formRegistry со своим рецептом.
		expect(inferListRestore(comp("SalesForm") as never, { uuid: "abc-123" })).toBeUndefined();
	});

	it("панель вне реестра (диалог выбора) рецепта не получает", () => {
		expect(inferListRestore(comp("SomeSelectorDialog") as never)).toBeUndefined();
		expect(inferListRestore(undefined as never)).toBeUndefined();
	});
});
