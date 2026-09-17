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

	it("недоступная база — «Скрыть» и «Удалить регистрацию из кластера»", () => {
		show({ ibUnreachableAt: "2026-09-17T08:00:00Z", ibUnreachableReason: "NO_DB" });
		expect(buttons()).toEqual(expect.arrayContaining(["Скрыть базу", "Удалить регистрацию из кластера"]));
		expect(buttons()).not.toContain("Убрать из списка");
	});

	it("скрытая база, которая есть в кластере, — «Вернуть в работу»", () => {
		show({ status: "DISABLED", hidden: true });
		expect(buttons().some((t) => t?.includes("Вернуть"))).toBe(true);
		expect(buttons()).not.toContain("Убрать из списка");
	});

	it("базы нет в кластере (и она скрыта) — только «Убрать из списка»: удалять регистрацию нечего", () => {
		show({ status: "DISABLED", clusterStatus: "MISSING", hidden: true, ibUnreachableAt: "t", ibUnreachableReason: "NO_INFOBASE" });
		expect(buttons()).toEqual(["Убрать из списка"]);
		expect(screen.getByText(/Регистрации этой базы в кластере нет/)).toBeTruthy();
	});

	it("«Убрать из списка» — после подтверждения вызывает сервис и закрывает карточку", async () => {
		const onRemoved = vi.fn();
		show({ clusterStatus: "MISSING", status: "MISSING", onRemoved });
		fireEvent.click(screen.getByRole("button", { name: "Убрать из списка" }));
		expect(api.removeBaseFromRegistry).not.toHaveBeenCalled();
		const apply = screen.getAllByRole("button").find((b) => /Применить|ОК|Да|Выполнить/i.test(b.textContent ?? ""));
		expect(apply).toBeTruthy();
		fireEvent.click(apply!);
		await waitFor(() => expect(api.removeBaseFromRegistry).toHaveBeenCalledWith("nomadstroygroup"));
		await waitFor(() => expect(onRemoved).toHaveBeenCalled());
	});
});
