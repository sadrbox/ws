import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { TDataItem, DocRow } from "src/components/Table/types";
import type { TPane } from "src/app/types";

// Аудит 26.09 — экраны документов и учёта (У5, У6, У8, И20–И22).

const { apiMock } = vi.hoisted(() => ({
	apiMock: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("src/services/api/client", () => ({ __esModule: true, api: apiMock, default: {} }));

import {
	paymentRemainder, mapItemsForBasis, openDocumentFromBasis, confirmBasisItemsRefresh, mapPaymentFromBasis,
} from "src/utils/createFromBasis";
import { checkStockAvailability, withoutServiceShortages, type StockShortage } from "src/utils/stockControl";
import { cashAmountError } from "src/models/_shared/cashOrderAmount";
import { deviationSummary } from "src/models/StockCounts/deviationSummary";
import { discountPercentForAmount, withSaleItemRecalcFromDiscountAmount } from "src/models/Sales/saleItemDraft";
import { monthCloseDefaultDate, previousMonthPeriod } from "src/models/MonthCloses/monthCloseDates";
import { today, firstOfMonth } from "src/models/Reports/_shared/reportDates";
import { useReportFilters } from "src/models/Reports/_shared/useReportFilters";
import { setAppUtcOffset, getAppUtcOffset } from "src/utils/datetime";

beforeEach(() => {
	for (const f of Object.values(apiMock)) f.mockReset();
});

/** Данные панели, открытой «На основании» (первый вызов addPane). */
function openedData(addPane: { mock: { calls: Array<[Partial<TPane>]> } }) {
	return addPane.mock.calls[0][0].data as unknown as { uuid?: string; fromBasisFields: { date: string; amount?: string } };
}

// 01.10.2026 02:00 по Алматы (UTC+5) = 30.09.2026 21:00 UTC — «ночь первого числа».
const NIGHT_OF_FIRST = new Date("2026-09-30T21:00:00.000Z");

describe("У5 — местная дата, а не UTC", () => {
	let prevOffset = 5;
	beforeEach(() => { prevOffset = getAppUtcOffset(); setAppUtcOffset(5); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NIGHT_OF_FIRST); });
	afterEach(() => { vi.useRealTimers(); setAppUtcOffset(prevOffset); });

	it("«На основании»: дата нового документа — местные дата и время (раньше UTC-дата: 2026-09-30)", async () => {
		apiMock.get.mockResolvedValue({ items: [] });
		const addPane = vi.fn<(pane: Partial<TPane>) => void>();
		await openDocumentFromBasis(
			{ uuid: "s1", number: "5", date: "2026-09-29T10:00:00.000Z", amount: 100 },
			"Реализация",
			{ docLabel: "Возврат", FormComponent: () => null, basisType: "sale", sourceItemsEndpoint: "saleitems", sourceItemsParentField: "saleUuid", mapFields: () => ({}) },
			addPane,
		);
		const fields = openedData(addPane).fromBasisFields;
		expect(fields.date).toBe("2026-10-01T02:00");
	});

	it("отчёты: «сегодня» и «первое число» — по местной дате", () => {
		expect(today()).toBe("2026-10-01");
		expect(firstOfMonth()).toBe("2026-10-01");
	});

	it("У6: закрытие месяца по умолчанию — прошлый МЕСТНЫЙ месяц, дата — его конец", () => {
		expect(previousMonthPeriod()).toBe("2026-09"); // по UTC вышел бы август
		expect(monthCloseDefaultDate("2026-09")).toBe("2026-09-30T23:59");
		expect(monthCloseDefaultDate("2024-02")).toBe("2024-02-29T23:59");
		expect(monthCloseDefaultDate("")).toBe("");
	});
});

describe("И21 — «На основании»: партия и частичные оплаты", () => {
	it("партия строки основания переносится (возврат поставщику партионного товара без неё — 422)", () => {
		const [r] = mapItemsForBasis([{ uuid: "pi1", productUuid: "p1", quantity: 2, price: 10, batchUuid: "b1" } as DocRow]);
		expect(r.batchUuid).toBe("b1");
		expect(r.sourceRowId).toBe("pi1");
	});

	it("остаток к оплате", () => {
		expect(paymentRemainder(1000, [])).toBeNull();
		expect(paymentRemainder("1000.00", ["400.00", 100])).toBe("500.00");
		expect(paymentRemainder(1000, [1000])).toBe("");
		expect(paymentRemainder(1000, [1200])).toBe("");
	});

	it("вторая оплата: меню создаёт НОВЫЙ платёж на остаток, а не открывает первый", async () => {
		apiMock.get.mockImplementation((url: string) => Promise.resolve(url === "/bank-statements" ? { items: [{ amount: "300.00" }] } : { items: [] }));
		const addPane = vi.fn<(pane: Partial<TPane>) => void>();
		await openDocumentFromBasis(
			{ uuid: "inv1", amount: "1000.00" },
			"Счёт на оплату",
			{
				docLabel: "Выписка", FormComponent: () => null, basisType: "payment_invoice",
				sourceItemsEndpoint: "paymentinvoiceitems", sourceItemsParentField: "paymentInvoiceUuid",
				mapFields: mapPaymentFromBasis, mapItems: () => [], paidByEndpoint: "bank-statements",
			},
			addPane,
		);
		const data = openedData(addPane);
		expect(data.uuid).toBeUndefined(); // не открыт существующий
		expect(data.fromBasisFields.amount).toBe("700.00");
		const call = (apiMock.get.mock.calls as unknown[][]).find((c) => c[0] === "/bank-statements");
		expect(call?.[1]).toMatchObject({ params: { filter: { basisDocumentUuid: { equals: "inv1" } } } });
	});
});

describe("И20 — «Обновить» по основанию спрашивает, если строки изменятся", () => {
	const basis = { items: [{ uuid: "b1", productUuid: "p1", quantity: 10, price: 5, vatRate: 12, exciseRate: 0, discountPercent: 0 }] };
	const serverRow = (qty: number): DocRow => ({ id: 1, uuid: "r1", sourceRowId: "b1", productUuid: "p1", quantity: qty, price: 5, vatRate: 12, exciseRate: 0, discountPercent: 0 } as DocRow);
	beforeEach(() => {
		apiMock.get.mockImplementation((url: string) => Promise.resolve(url.startsWith("/sales/") ? { item: { uuid: "s1" } } : basis));
	});

	it("ручная правка (отгрузили 4 из 10) — подтверждение", async () => {
		const confirm = vi.fn().mockResolvedValue(false);
		expect(await confirmBasisItemsRefresh({ basisType: "sale", basisUuid: "s1", displayed: [serverRow(4)], confirm })).toBe(false);
		expect(confirm).toHaveBeenCalledTimes(1);
	});

	it("строки совпадают с основанием — без вопроса", async () => {
		const confirm = vi.fn();
		expect(await confirmBasisItemsRefresh({ basisType: "sale", basisUuid: "s1", displayed: [serverRow(10)], confirm })).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
	});
});

describe("У8 — услуги не проверяются на остаток", () => {
	const shortage = (productUuid: string): StockShortage => ({
		productUuid, productName: productUuid, warehouseUuid: "wh", warehouseName: "Склад", requested: 1, available: 0, deficit: 1,
	});

	it("строка, помеченная услугой, в проверку не уходит", async () => {
		const res = await checkStockAvailability({ documentType: "sale", items: [{ productUuid: "svc", quantity: 1, isService: true }] });
		expect(res).toEqual([]);
		expect(apiMock.post).not.toHaveBeenCalled();
	});

	it("дефицит по товару-услуге снимается по карточке товара (раньше «Доставка — доступно 0»)", async () => {
		apiMock.post.mockResolvedValue({ success: true, ok: false, shortages: [shortage("svc"), shortage("tea")] });
		apiMock.get.mockImplementation((url: string) => Promise.resolve({ item: { isService: url === "/products/svc" } }));
		const res = await checkStockAvailability({ documentType: "sale", items: [{ productUuid: "svc", quantity: 1 }, { productUuid: "tea", quantity: 1 }] });
		expect(res.map((s) => s.productUuid)).toEqual(["tea"]);
	});

	it("withoutServiceShortages", () => {
		expect(withoutServiceShortages([shortage("a"), shortage("b")], new Set(["a"]))).toHaveLength(1);
	});
});

describe("У8 — ПКО/РКО с нулевой суммой не проводятся", () => {
	it("проведённый с пустой/нулевой суммой — ошибка формы; черновик — можно", () => {
		expect(cashAmountError({ posted: true, amount: "" })).not.toBe("");
		expect(cashAmountError({ posted: true, amount: "0" })).not.toBe("");
		expect(cashAmountError({ posted: true, amount: "0,00" })).not.toBe("");
		expect(cashAmountError({ posted: true, amount: "150.5" })).toBe("");
		expect(cashAmountError({ posted: false, amount: "" })).toBe("");
	});
});

describe("И21 — сводка инвентаризации", () => {
	it("излишек и недостача считаются по строкам (раньше всегда 0 / 0)", () => {
		const rows = [
			{ quantity: 8, accountingQuantity: 10 },
			{ quantity: 5, accountingQuantity: 3 },
			{ quantity: 1, accountingQuantity: 0, _pendingAction: "delete" },
		] as unknown as TDataItem[];
		expect(deviationSummary(rows)).toEqual({ surplus: 2, shortage: 2 });
	});
});

describe("И22 — скидка суммой без потери копейки", () => {
	const r2 = (x: number) => Math.round(x * 100) / 100;
	it("сумма скидки в строке = та, что посчитает сервер из процента, и сходится с итогом; до 10 000 ₸ — ровно введённая", () => {
		// Раньше примерно в половине случаев (база до 50 000) скидка в строке и итог расходились на 0,01.
		let seed = 7;
		const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
		for (let i = 0; i < 5000; i++) {
			const price = r2(rnd() * 50000);
			const typed = r2(rnd() * price);
			const res = withSaleItemRecalcFromDiscountAmount({ quantity: 1, price, vatRate: 0 }, typed) as { discountAmount: number; discountPercent: number; amount: number };
			expect(res.discountAmount).toBe(r2((price * res.discountPercent) / 100));
			expect(res.amount).toBe(r2(price - res.discountAmount));
			if (price < 10000) expect(res.discountAmount).toBe(typed);
		}
	});

	it("крупная база: сумма скидки — ближайшая представимая, а не расходящаяся с итогом", () => {
		const base = 987654.32;
		const pct = discountPercentForAmount(base, 1234.56);
		const res = withSaleItemRecalcFromDiscountAmount({ quantity: 1, price: base, vatRate: 0 }, 1234.56) as { discountAmount: number; amount: number };
		expect(res.discountAmount).toBe(r2((base * pct) / 100));
		expect(res.amount).toBe(r2(base - res.discountAmount));
	});
});

describe("И21 — повторное «Сформировать» делает новый запрос", () => {
	it("три нажатия с теми же фильтрами — три запроса (раньше один, остальное из кэша)", async () => {
		let calls = 0;
		function Rep() {
			const { applied, handleGenerate } = useReportFilters({ persistKey: "t.audit.rep", defaults: { dateFrom: "2026-09-01", dateTo: "2026-09-30" } });
			const { data } = useQuery({ queryKey: ["rep", applied], queryFn: () => Promise.resolve(++calls), enabled: !!applied });
			return <div><button onClick={handleGenerate}>gen</button><span data-testid="v">{String(data ?? "")}</span></div>;
		}
		const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 2 * 60 * 1000, retry: false } } });
		const r = render(<QueryClientProvider client={qc}><Rep /></QueryClientProvider>);
		fireEvent.click(r.getByText("gen"));
		await waitFor(() => expect(r.getByTestId("v").textContent).toBe("1"));
		fireEvent.click(r.getByText("gen"));
		await waitFor(() => expect(r.getByTestId("v").textContent).toBe("2"));
		fireEvent.click(r.getByText("gen"));
		await waitFor(() => expect(r.getByTestId("v").textContent).toBe("3"));
		expect(calls).toBe(3);
	});
});
