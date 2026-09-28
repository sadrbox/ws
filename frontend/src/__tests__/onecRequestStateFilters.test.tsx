/**
 * Отбор заявок по состоянию — плашками (группа радиокнопок, SegmentedControl) во всех вкладках заявок: «Подключение
 * баз» и «Подключение агентов» (enr_state). Варианты — общие (stateFilterOptions). Активации БИНов больше нет (В8).
 */
import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestWrapper } from "src/__tests__/utils/TestWrapper";
import { translate } from "src/i18";

const api = vi.hoisted(() => {
	const enrollment = {
		id: "e1", code: "ABCD-1234", computer: "SRV1C", serviceName: "BuhProfAgent", name: "Сервер 1С", role: "admin",
		serverName: null, version: null, ip: null, repeats: 0, state: "PENDING", note: null, decidedBy: null, decidedAt: null,
		agentId: null, tokenDeliveredAt: null, createdAt: "2026-09-27T10:00:00Z",
		expiresAt: "2026-09-28T10:00:00Z", previousAgentId: null, pendingSiblings: 0, newerPendingCode: null,
	};
	// Нерешённая заявка — в «Ждут решения» и во «Все», в остальных отборах пусто.
	const byState = <T,>(item: T) => (p: { state?: string } = {}) =>
		Promise.resolve({ items: !p.state || p.state === "PENDING" ? [item] : [], canDecide: false });
	return {
		fetchEnrollments: vi.fn(byState(enrollment)),
		fetchAgents: vi.fn(() => Promise.resolve({ items: [] })),
	};
});
vi.mock("src/services/onec/api", async (orig) => ({ ...(await orig<typeof import("src/services/onec/api")>()), ...api }));

import { stateFilterOptions } from "src/models/OneCAdmin/requestsView";
import { EnrollmentsTab } from "src/models/OneCAdmin/EnrollmentsTab";

function mount(ui: ReactElement) {
	const { container } = render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<TestWrapper>{ui}</TestWrapper>
		</QueryClientProvider>,
	);
	const group = screen.getByRole("radiogroup", { name: translate("status") });
	return { container, group, radios: within(group).getAllByRole("radio") };
}

describe("stateFilterOptions", () => {
	it("нерешённые — первыми, «Все» — последним; тон — цвет состояния; число — только у «Ждут решения»", () => {
		const opts = stateFilterOptions(["PENDING", "APPROVED", "REJECTED", "EXPIRED"], 3);
		expect(opts.map((o) => o.value)).toEqual(["PENDING", "APPROVED", "REJECTED", "EXPIRED", ""]);
		expect(opts.map((o) => o.label)).toEqual([
			translate("onecReqFilterPending"), translate("onecReqFilterApproved"), translate("onecReqFilterRejected"),
			translate("onecReqFilterExpired"), translate("onecReqAll"),
		]);
		expect(opts.map((o) => o.tone)).toEqual(["wait", "ok", "bad", "off", "all"]);
		expect(opts.map((o) => o.count ?? null)).toEqual([3, null, null, null, null]);
	});

});

describe("«Подключение агентов»: отбор enr_state — группа радиокнопок", () => {
	beforeEach(() => api.fetchEnrollments.mockClear());

	it("пять плашек, выбрано «Ждут решения»; стрелка вправо — «Одобренные»", async () => {
		const { container, group, radios } = mount(<EnrollmentsTab />);
		expect(container.querySelector('select[name="enr_state"]')).toBeNull();
		expect(radios.map((r) => r.id)).toEqual(["enr_state-PENDING", "enr_state-APPROVED", "enr_state-REJECTED", "enr_state-EXPIRED", "enr_state-all"]);
		expect(radios[0].getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(group, { key: "ArrowRight" });
		expect(radios[1].getAttribute("aria-checked")).toBe("true");
		await waitFor(() => expect(api.fetchEnrollments).toHaveBeenCalledWith({ state: "APPROVED" }));
	});

	it("при другом отборе число нерешённых остаётся у «Ждут решения»", async () => {
		const { radios } = mount(<EnrollmentsTab />);
		fireEvent.click(radios[3]);
		await waitFor(() => expect(api.fetchEnrollments).toHaveBeenCalledWith({ state: "EXPIRED" }));
		await waitFor(() => expect(radios[0].textContent).toBe(`${translate("onecReqFilterPending")}1`));
	});
});
