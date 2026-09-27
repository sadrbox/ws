/**
 * E17 СК5.3: блок решения по записи реестра нарушений.
 *
 * Держит главное: кнопки — по признакам записи (решающий / сам нарушитель), проверка
 * «самовыявлено» и причины отклонения — до запроса (сервер ответил бы тем же отказом), а
 * удачное решение перечитывает запись.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { translate } from "src/i18";
import { AppContextProvider } from "src/app/context";
import type { TypeAppContextProps } from "src/app/types";
import type { ViolationStatus } from "src/services/quality/api";

const api = vi.hoisted(() => ({
	confirmViolation: vi.fn(() => Promise.resolve({ success: true })),
	rejectViolation: vi.fn(() => Promise.resolve({ success: true })),
	disputeViolation: vi.fn(() => Promise.resolve({ success: true })),
	resolveDispute: vi.fn(() => Promise.resolve({ success: true })),
	fetchQualityMe: vi.fn(() => Promise.resolve({ isAdmin: false })),
}));
vi.mock("src/services/quality/api", () => api);

import DecisionBlock from "src/models/StandardViolations/DecisionBlock";

const ctx = (confirm = true): TypeAppContextProps => ({
	screenRef: { current: null },
	windows: {
		panes: [], paneOrder: [], activePane: null, addPane: () => { }, requestClose: async () => { }, reloadPane: async () => { },
		setActivePane: () => { }, updatePaneLabel: () => { }, registerBeforeClose: () => () => { },
	},
	actions: { confirm: () => Promise.resolve(confirm) },
	navbar: { props: [], setProps: () => { } },
	auth: { user: { uuid: "me", username: "me" }, logout: () => { } },
});

function setup(p: { status: ViolationStatus; canDecide?: boolean; isMine?: boolean; selfDetected?: boolean; decidedByUuid?: string; canResolveDispute?: boolean }) {
	const onDone = vi.fn();
	const onNotices = vi.fn();
	const wrap = (node: ReactNode) => (
		<QueryClientProvider client={new QueryClient()}>
			<AppContextProvider value={ctx()}>{node}</AppContextProvider>
		</QueryClientProvider>
	);
	render(wrap(
		<DecisionBlock uuid="v-1" status={p.status} selfDetected={!!p.selfDetected} canDecide={!!p.canDecide} isMine={!!p.isMine}
			decidedByUuid={p.decidedByUuid} canResolveDispute={p.canResolveDispute} source="test" onDone={onDone} onNotices={onNotices} />,
	));
	return { onDone, onNotices };
}

const button = (key: string) => screen.getByRole("button", { name: translate(key) });

describe("блок решения по нарушению", () => {
	beforeEach(() => {
		Object.values(api).forEach((f) => f.mockClear());
		api.fetchQualityMe.mockImplementation(() => Promise.resolve({ isAdmin: false }));
	});

	it("решающему по кандидату — «Подтвердить» и «Отклонить», оспорить нечего", () => {
		setup({ status: "candidate", canDecide: true });
		expect(button("violationConfirm")).toBeTruthy();
		expect(button("violationReject")).toBeTruthy();
		expect(screen.queryByRole("button", { name: translate("violationDispute") })).toBeNull();
	});

	it("нарушителю по подтверждённому — только «Оспорить»", () => {
		setup({ status: "confirmed", isMine: true });
		expect(button("violationDispute")).toBeTruthy();
		expect(screen.queryByRole("button", { name: translate("violationConfirm") })).toBeNull();
		expect(screen.queryByRole("button", { name: translate("violationReject") })).toBeNull();
	});

	it("без права решения и не своё — действий нет, только пояснение", () => {
		setup({ status: "candidate" });
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(screen.getByText(translate("violationNoActions"))).toBeTruthy();
	});

	it("отклонение без причины не уходит на сервер", async () => {
		const { onNotices } = setup({ status: "candidate", canDecide: true });
		fireEvent.click(button("violationReject"));
		await waitFor(() => expect(onNotices).toHaveBeenCalledWith([{ type: "error", text: translate("violationRejectReasonRequired") }]));
		expect(api.rejectViolation).not.toHaveBeenCalled();
	});

	it("«самовыявлено» без всех условий не уходит на сервер", async () => {
		const { onNotices } = setup({ status: "candidate", canDecide: true });
		fireEvent.click(screen.getByRole("checkbox", { name: translate("violationSelfDetected") }));
		fireEvent.click(screen.getByRole("checkbox", { name: translate("violationCondSelfCheck") }));
		fireEvent.click(button("violationConfirmSelfDetected"));
		await waitFor(() => expect(onNotices).toHaveBeenCalledWith([{ type: "error", text: translate("violationSelfDetectedConditions") }]));
		expect(api.confirmViolation).not.toHaveBeenCalled();
	});

	it("«самовыявлено» со всеми обязательными условиями — подтверждение с условиями, запись перечитана", async () => {
		const { onDone } = setup({ status: "candidate", canDecide: true });
		fireEvent.click(screen.getByRole("checkbox", { name: translate("violationSelfDetected") }));
		for (const key of ["violationCondSelfCheck", "violationCondFixedInTime", "violationCondNoConsequences"]) {
			fireEvent.click(screen.getByRole("checkbox", { name: translate(key) }));
		}
		fireEvent.click(button("violationConfirmSelfDetected"));
		await waitFor(() => expect(onDone).toHaveBeenCalled());
		expect(api.confirmViolation).toHaveBeenCalledWith("v-1", {
			note: undefined, selfDetected: true,
			selfDetectedInfo: { foundBySelfCheck: true, fixedInTime: true, reported: false, noConsequences: true },
		});
	});

	it("отклонение с причиной — запрос с причиной и перечитывание", async () => {
		const { onDone } = setup({ status: "confirmed", canDecide: true });
		fireEvent.change(screen.getByLabelText(translate("violationRejectReason")), { target: { value: "  Клиент не наш  " } });
		fireEvent.click(button("violationReject"));
		await waitFor(() => expect(onDone).toHaveBeenCalled());
		expect(api.rejectViolation).toHaveBeenCalledWith("v-1", "Клиент не наш");
	});

	// И24: по возражению решает не тот, кто подтверждал, — иначе «Решить» вела к 403.
	it("возражение: подтверждавшему — не «Решить», а пояснение про уровень выше", async () => {
		setup({ status: "disputed", canDecide: true, decidedByUuid: "me" });
		await waitFor(() => expect(api.fetchQualityMe).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: translate("violationResolve") })).toBeNull();
		expect(screen.getByText(translate("violationResolveHint"))).toBeTruthy();
	});

	it("возражение: решающему уровнем выше — «Решить»", () => {
		setup({ status: "disputed", canDecide: true, decidedByUuid: "chief" });
		expect(button("violationResolve")).toBeTruthy();
	});

	it("возражение: администратор решает и по своему подтверждению", async () => {
		api.fetchQualityMe.mockImplementation(() => Promise.resolve({ isAdmin: true }));
		setup({ status: "disputed", canDecide: true, decidedByUuid: "me" });
		expect(await screen.findByRole("button", { name: translate("violationResolve") })).toBeTruthy();
	});

	// Слово сервера (canResolveDispute) главнее догадки панели: коллега того же уровня, что подтверждавший, тоже не решает.
	it("возражение: сервер запретил (коллега того же уровня) — «Решить» нет, хотя подтверждал не я", async () => {
		setup({ status: "disputed", canDecide: true, decidedByUuid: "chief", canResolveDispute: false });
		await waitFor(() => expect(api.fetchQualityMe).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: translate("violationResolve") })).toBeNull();
		expect(screen.getByText(translate("violationResolveHint"))).toBeTruthy();
	});

	it("возражение: сервер разрешил — «Решить» есть, даже если по decidedByUuid подтверждал я", () => {
		setup({ status: "disputed", canDecide: true, decidedByUuid: "me", canResolveDispute: true });
		expect(button("violationResolve")).toBeTruthy();
	});
});
