import { describe, it, expect, vi } from "vitest";
import {
	EMPTY_FINDINGS_FILTER, findingDocuments, findingObjects, findingStateTone, findingsQuery, formatDetails,
	pickFindingsFilter, pickRunsFilter, runsQuery, severityTone,
} from "src/models/CheckFindings/findingsView";
import { consumePaneFilter, requestPaneFilter, subscribePaneFilter } from "src/models/CheckFindings/paneFilterBus";
import { checkCodesOfArea } from "src/services/quality/checkCatalog";

// «Проверки учёта 1С» (E17 СК2): отборы списка находок (параметры роута), разбор данных
// находки из 1С и отложенный отбор для уже открытого списка.

describe("Отбор находок → параметры запроса", () => {
	it("по умолчанию — только открытые, без отборов по полям", () => {
		expect(findingsQuery(EMPTY_FINDINGS_FILTER)).toEqual({ extraQueryParams: { state: "open" }, extraFilter: undefined });
	});

	it("организация и состояние — прямыми параметрами, важность — filter[severity]", () => {
		const q = findingsQuery({ ...EMPTY_FINDINGS_FILTER, organizationUuid: "org-1", state: "all", severity: "error" });
		expect(q.extraQueryParams).toEqual({ state: "all", organizationUuid: "org-1" });
		expect(q.extraFilter).toEqual({ severity: "error" });
	});

	it("участок — набор кодов его проверок (in); выбранная проверка точнее участка и заменяет его", () => {
		const byArea = findingsQuery({ ...EMPTY_FINDINGS_FILTER, area: "stock" });
		expect(byArea.extraFilter).toEqual({ checkCode: { operator: "in", value: checkCodesOfArea("stock").join(",") } });
		const byCheck = findingsQuery({ ...EMPTY_FINDINGS_FILTER, area: "stock", checkCode: "stock.negative" });
		expect(byCheck.extraFilter).toEqual({ checkCode: "stock.negative" });
	});

	it("отбор из данных панели: только известные поля и допустимые значения", () => {
		expect(pickFindingsFilter({ organizationUuid: "o", organizationName: "ТОО", state: "exception", severity: "fatal", area: "moon", checkCode: "x.y", extra: 1 }))
			.toEqual({ organizationUuid: "o", organizationName: "ТОО", state: "exception", checkCode: "x.y" });
		expect(pickFindingsFilter(undefined)).toEqual({});
		expect(pickFindingsFilter({ organizationName: "без uuid" })).toEqual({});
	});

	it("журнал прогонов: организация параметром, итог — filter[status]", () => {
		expect(runsQuery({ organizationUuid: "", organizationName: "", status: "" })).toEqual({ extraQueryParams: undefined, extraFilter: undefined });
		expect(runsQuery({ organizationUuid: "o", organizationName: "", status: "error" })).toEqual({ extraQueryParams: { organizationUuid: "o" }, extraFilter: { status: "error" } });
		expect(pickRunsFilter({ status: "broken", organizationUuid: "o" })).toEqual({ organizationUuid: "o", organizationName: "" });
	});

	it("цвета: ошибка — красный, предупреждение — оранжевый, подсказка — серый; устранена — зелёный", () => {
		expect(severityTone("error")).toBe("bad");
		expect(severityTone("warning")).toBe("warn");
		expect(severityTone("info")).toBe("muted");
		expect(findingStateTone("resolved")).toBe("ok");
		expect(findingStateTone("exception")).toBe("info");
		expect(findingStateTone("open")).toBe("warn");
	});
});

describe("Данные находки из 1С", () => {
	const data = {
		objects: [{ kind: "product", id: "4b2e", name: "Бумага А4" }, { kind: "warehouse", id: "77aa" }, null, "мусор", {}],
		documents: [{ kind: "sale", documentType: "РеализацияТоваровУслуг", id: "d1", number: "0000123", date: "2026-08-14", posted: true, author: "Иванова А." }, { note: "без полей" }],
		details: { problem: "negative" },
	};

	it("объекты: вид, id, наименование; пустые и не-объекты отбрасываются", () => {
		expect(findingObjects(data)).toEqual([
			{ kind: "product", id: "4b2e", name: "Бумага А4" },
			{ kind: "warehouse", id: "77aa", name: "" },
		]);
		expect(findingObjects(null)).toEqual([]);
	});

	it("документы: с идентификатором 1С, признаком проведения и автором", () => {
		expect(findingDocuments(data)).toEqual([
			{ kind: "sale", documentType: "РеализацияТоваровУслуг", id: "d1", number: "0000123", date: "2026-08-14", posted: true, author: "Иванова А." },
		]);
	});

	it("реквизиты — JSON с отступами; пустой объект и null — пусто", () => {
		expect(formatDetails(data.details)).toBe('{\n  "problem": "negative"\n}');
		expect(formatDetails({})).toBe("");
		expect(formatDetails(null)).toBe("");
		expect(formatDetails([1, 2])).toBe("[\n  1,\n  2\n]");
	});
});

describe("Отложенный отбор для списка-синглтона", () => {
	it("список ещё не открыт — отбор ждёт и забирается один раз", () => {
		requestPaneFilter("t-pending", { a: 1 });
		expect(consumePaneFilter("t-pending")).toEqual({ a: 1 });
		expect(consumePaneFilter("t-pending")).toBeUndefined();
	});

	it("список открыт — отбор уходит подписчику и в очереди не остаётся", () => {
		const fn = vi.fn();
		const off = subscribePaneFilter("t-live", fn);
		requestPaneFilter("t-live", { b: 2 });
		expect(fn).toHaveBeenCalledWith({ b: 2 });
		expect(consumePaneFilter("t-live")).toBeUndefined();
		off();
		requestPaneFilter("t-live", { c: 3 });
		expect(fn).toHaveBeenCalledTimes(1);
		expect(consumePaneFilter("t-live")).toEqual({ c: 3 });
	});

	it("ключи независимы", () => {
		requestPaneFilter("t-x", 1);
		expect(consumePaneFilter("t-y")).toBeUndefined();
		expect(consumePaneFilter("t-x")).toBe(1);
	});
});
