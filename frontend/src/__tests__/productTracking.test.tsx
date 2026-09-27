/**
 * Учёт товара по сериям и партиям в строке документа (аудит 26.09, О4).
 *
 * Раньше ячейки «Серии» и «Партия» читали одну и ту же карточку товара двумя запросами под
 * разными ключами, а дата документа в ключе давала повторные запросы при её смене. Проверяем:
 * один запрос на товар для обеих ячеек, ни одного — когда признаки уже есть в строке, и
 * никакого перезапроса при смене даты документа.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SerialNumbersCell } from "src/components/DocumentItemsTable/SerialNumbersCell";
import { BatchNumbersCell } from "src/components/DocumentItemsTable/BatchNumbersCell";
import { trackingFromRow, trackingOnDate } from "src/components/DocumentItemsTable/productTracking";

const getMock = vi.fn<(url: string, config?: unknown) => Promise<unknown>>();

vi.mock("src/services/api/client", () => ({
	__esModule: true,
	default: {
		get: (url: string, config?: unknown) => getMock(url, config),
		post: vi.fn(),
	},
}));
vi.mock("src/i18", () => ({ translate: (key: string) => key }));
vi.mock("src/app/context", () => ({
	useAppContext: () => ({ windows: { addPane: vi.fn() } }),
	useAppActions: () => ({ windows: { addPane: vi.fn() } }),
}));

const SINCE = "2026-01-01T00:00:00.000Z";

function productCalls(uuid: string) {
	return getMock.mock.calls.filter(([url]) => url === `products/${uuid}`).length;
}

function cells(documentDate: string, product?: Record<string, unknown>) {
	return (
		<>
			<SerialNumbersCell productUuid="p1" quantity={1} docType="sale" docUuid="d1" mode="issue" warehouseUuid="w1"
				documentDate={documentDate} product={product} />
			<BatchNumbersCell productUuid="p1" mode="issue" batchUuid="" onChange={() => undefined} warehouseUuid="w1"
				documentDate={documentDate} product={product} />
		</>
	);
}

describe("учёт товара по сериям и партиям", () => {
	beforeEach(() => {
		getMock.mockReset();
		getMock.mockImplementation((url: string) => {
			if (url === "products/p1") {
				return Promise.resolve({ data: { item: { trackSerialNumbers: true, serialTrackingSince: SINCE, trackBatches: true, batchTrackingSince: SINCE } } });
			}
			return Promise.resolve({ data: { items: [] } });
		});
	});

	it("обе ячейки строки делят ОДИН запрос карточки товара, смена даты его не повторяет", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { rerender } = render(<QueryClientProvider client={client}>{cells("2026-07-15")}</QueryClientProvider>);
		await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(2));
		expect(productCalls("p1")).toBe(1);

		// Документ перенесли на дату раньше включения учёта: ячейки гаснут без нового запроса.
		rerender(<QueryClientProvider client={client}>{cells("2025-06-01")}</QueryClientProvider>);
		await waitFor(() => expect(screen.queryAllByRole("button")).toHaveLength(0));
		expect(productCalls("p1")).toBe(1);
	});

	it("признаки из строки документа — без запроса карточки", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const product = { trackSerialNumbers: true, serialTrackingSince: SINCE, trackBatches: true, batchTrackingSince: null };
		render(<QueryClientProvider client={client}>{cells("2026-07-15", product)}</QueryClientProvider>);
		await waitFor(() => expect(screen.getAllByRole("button")).toHaveLength(2));
		expect(productCalls("p1")).toBe(0);
	});

	it("trackingFromRow: «не учитывается» — по флагу, «учитывается» — только вместе с моментом включения", () => {
		expect(trackingFromRow({ trackSerialNumbers: false }, "serial")).toEqual({ tracked: false, since: null });
		// Товар только что выбран в лукапе: флаг есть, момента включения нет — нужен запрос.
		expect(trackingFromRow({ trackSerialNumbers: true }, "serial")).toBeNull();
		expect(trackingFromRow({ trackBatches: true, batchTrackingSince: null }, "batch")).toEqual({ tracked: true, since: null });
		expect(trackingFromRow(undefined, "batch")).toBeNull();
	});

	it("trackingOnDate: учёт не применяется задним числом", () => {
		expect(trackingOnDate(true, SINCE, "2026-02-01")).toEqual({ ok: true, since: null });
		expect(trackingOnDate(true, SINCE, "2025-12-31")).toEqual({ ok: false, since: SINCE });
		expect(trackingOnDate(true, null, "2000-01-01")).toEqual({ ok: true, since: null });
		expect(trackingOnDate(false, SINCE, "2026-02-01")).toEqual({ ok: false, since: null });
	});
});
