/**
 * Карточка базы → «Доступность»: кнопки по состоянию базы (П32).
 *
 * ЖИВОЙ СЛУЧАЙ (17.09). nomadstroygroup скрыли и удалили её регистрацию из кластера. Карточка предлагала «Удалить
 * регистрацию из кластера» — удалять было нечего, — а «Вернуть в работу» отвечала «нет в реестре». Убрать строку из
 * списка было нечем.
 */
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TestWrapper } from "./utils/TestWrapper";

const api = vi.hoisted(() => ({
	removeBaseFromRegistry: vi.fn(() => Promise.resolve({ ok: true, removed: true })),
	dropBaseRegistration: vi.fn(),
	setBaseHidden: vi.fn(),
}));
vi.mock("src/services/onec/api", () => api);
vi.mock("src/models/OneCAdmin/shared", () => ({
	useOnecWrite: () => true,
	unreachableReason: () => "причина",
}));
vi.mock("src/models/OneCAdmin/progress", () => ({
	withOp: (_op: unknown, fn: () => Promise<unknown>) => fn(),
}));

import { BaseAvailability } from "src/models/OneCBases/BaseAvailability";

type Props = Parameters<typeof BaseAvailability>[0];
const show = (over: Partial<Props> = {}) => render(
	<TestWrapper>
		<QueryClientProvider client={new QueryClient()}>
			<BaseAvailability baseKey="nomadstroygroup" status="ONLINE" clusterStatus="ONLINE" hidden={false}
				ibUnreachableAt={null} ibUnreachableReason={null} {...over} />
		</QueryClientProvider>
	</TestWrapper>,
);
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim());

describe("«Доступность» по состоянию базы", () => {
	beforeEach(() => { api.removeBaseFromRegistry.mockClear(); });

	it("рабочая база — раздел молчит", () => {
		const { container } = show();
		expect(container.textContent).toBe("");
	});

	it("недоступная база — «Скрыть базу в панели» и «Снять регистрацию базы в кластере 1С»", () => {
		show({ ibUnreachableAt: "2026-09-17T08:00:00Z", ibUnreachableReason: "NO_DB" });
		expect(buttons()).toEqual(expect.arrayContaining(["Скрыть базу в панели", "Снять регистрацию базы в кластере 1С"]));
		expect(buttons()).not.toContain("Удалить запись о базе в панели");
	});

	it("скрытая база, которая есть в кластере, — «Вернуть в работу»", () => {
		show({ status: "DISABLED", hidden: true });
		expect(buttons().some((t) => t?.includes("Вернуть"))).toBe(true);
		expect(buttons()).not.toContain("Удалить запись о базе в панели");
	});

	it("базы нет в кластере (и она скрыта) — только «Удалить запись о базе в панели»: в кластере снимать нечего", () => {
		show({ status: "DISABLED", clusterStatus: "MISSING", hidden: true, ibUnreachableAt: "t", ibUnreachableReason: "NO_INFOBASE" });
		expect(buttons()).toEqual(["Удалить запись о базе в панели"]);
		expect(screen.getByText(/Регистрации этой базы в кластере 1С нет/)).toBeTruthy();
	});

	it("«Удалить запись о базе в панели» — после подтверждения вызывает сервис и закрывает карточку", async () => {
		const onRemoved = vi.fn();
		show({ clusterStatus: "MISSING", status: "MISSING", onRemoved });
		fireEvent.click(screen.getByRole("button", { name: "Удалить запись о базе в панели" }));
		expect(api.removeBaseFromRegistry).not.toHaveBeenCalled();
		// Кнопка подтверждения — по точному имени: нестрогий образец («Да») ловил и саму кнопку «Удалить…».
		fireEvent.click(screen.getByRole("button", { name: "Применить" }));
		await waitFor(() => expect(api.removeBaseFromRegistry).toHaveBeenCalledWith("nomadstroygroup"));
		await waitFor(() => expect(onRemoved).toHaveBeenCalled());
	});
});
