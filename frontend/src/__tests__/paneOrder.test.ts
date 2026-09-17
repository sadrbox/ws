/**
 * Порядок вкладок панелей: активная — первая, прежняя первая — вторая.
 *
 * Сценарий проверяем на чистых функциях (promotePaneOrder + orderPanes): в App они
 * складываются ровно так же — активация зовёт promotePaneOrder, ряд вкладок рисуется
 * через orderPanes.
 */
import { describe, expect, it } from "vitest";
import { orderPanes, promotePaneOrder } from "src/app/paneOrder";

const panes = (...ids: string[]) => ids.map((uniqId) => ({ uniqId }));
const ids = (list: { uniqId: string }[]) => list.map((p) => p.uniqId);

describe("порядок вкладок панелей", () => {
	it("активация выносит вкладку в начало, прежняя первая уходит на второе место", () => {
		let order = ["a", "b", "c"];
		order = promotePaneOrder(order, "c");
		expect(order).toEqual(["c", "a", "b"]);
		order = promotePaneOrder(order, "b");
		expect(order).toEqual(["b", "c", "a"]);
	});

	it("активация текущей вкладки ничего не переставляет — и не создаёт новый массив", () => {
		const order = ["a", "b"];
		expect(promotePaneOrder(order, "a")).toBe(order);
	});

	it("ряд вкладок идёт по порядку активаций, а не по порядку открытия", () => {
		const open = panes("a", "b", "c");
		expect(ids(orderPanes(open, ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
	});

	it("панель, которой ещё нет в порядке, встаёт в конец и сохраняет своё место", () => {
		const open = panes("a", "b", "c", "d");
		expect(ids(orderPanes(open, ["b"]))).toEqual(["b", "a", "c", "d"]);
	});

	it("пустой порядок оставляет панели как есть", () => {
		const open = panes("a", "b");
		expect(orderPanes(open, [])).toBe(open);
	});
});
