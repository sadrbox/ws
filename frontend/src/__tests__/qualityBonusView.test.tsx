/**
 * E17 СК5.5: «Итоги месяца» — бонус виден сразу (метка), нарушения раскрываются под строкой,
 * закрытие месяца с нерешёнными кандидатами идёт вторым, осознанным подтверждением (force).
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { translate } from "src/i18";
import { usePaneToolbarSlot } from "src/hooks/usePaneToolbar";
import type { BonusMonthData } from "src/services/quality/api";
import { TestWrapper } from "./utils/TestWrapper";

const api = vi.hoisted(() => ({
	MEASURE_KINDS: ["talk", "training", "warning", "other"] as const,
	fetchBonus: vi.fn(),
	closeBonusMonth: vi.fn(),
	reopenBonusMonth: vi.fn(() => Promise.resolve({ success: true })),
	fetchMeasures: vi.fn(() => Promise.resolve({ success: true, items: [] })),
	createMeasure: vi.fn(),
	deleteMeasure: vi.fn(),
}));
vi.mock("src/services/quality/api", () => api);

vi.mock("src/hooks/useQualityMe", () => ({
	QUALITY_ME_KEY: ["quality", "me"],
	useQualityMe: () => ({
		me: { isAdmin: false, isHead: false, isManager: true, canManage: true, canDecide: true },
		canManage: true, isController: true, isLoading: false, refetch: () => { },
	}),
}));

import QualityBonusView from "src/models/QualityBonus";

const DATA: BonusMonthData = {
	month: "2026-09",
	closed: null,
	systematicMonths: 3,
	systematicThreshold: 3,
	items: [
		{
			userUuid: "u-1", userName: "Иванова А.", groupName: "Группа 1", role: "member", bonus: false, confirmedCount: 1,
			violations: [{ uuid: "v-1", itemNumber: 3, description: "Обращение не принято в срок", detectedAt: "2026-09-21T05:00:00Z" }],
			pendingCandidates: 1, disputed: 0, windowCount: 3, systematic: true, noMeasure: true,
		},
		{
			userUuid: "u-2", userName: "Петрова Б.", groupName: "Группа 1", role: "member", bonus: true, confirmedCount: 0,
			violations: [], pendingCandidates: 0, disputed: 0, windowCount: 0, systematic: false, noMeasure: false,
		},
	],
};

const Slot = () => {
	const { refCallback } = usePaneToolbarSlot("pane-bonus");
	return <div ref={refCallback} data-testid="slot" />;
};

function setup() {
	const wrap = (node: ReactNode) => (
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<TestWrapper>{node}</TestWrapper>
		</QueryClientProvider>
	);
	return render(wrap(<><Slot /><QualityBonusView uniqId="pane-bonus" /></>));
}

describe("Итоги месяца", () => {
	beforeEach(() => {
		api.fetchBonus.mockReset().mockResolvedValue(DATA);
		api.closeBonusMonth.mockReset();
	});

	it("бонус — меткой: у кого нарушение — «не начисляется», у остальных — «начисляется»", async () => {
		setup();
		expect(await screen.findByText(translate("bonusNo"))).toBeTruthy();
		expect(screen.getByText(translate("bonusYes"))).toBeTruthy();
		expect(screen.getByText(translate("bonusSystematicYes"))).toBeTruthy();
		// «Мер нет» — и заголовок колонки, и метка в строке: проверяем именно метку (StateChip с data-tone).
		expect(screen.getAllByText(translate("bonusNoMeasureYes")).some((el) => el.closest("[data-tone]"))).toBe(true);
	});

	it("нарушения раскрываются под строкой сотрудника", async () => {
		setup();
		const toggle = await screen.findByRole("button", { name: `${translate("violationItemShort")} 3` });
		expect(screen.queryByText("Обращение не принято в срок")).toBeNull();
		fireEvent.click(toggle);
		expect(await screen.findByText("Обращение не принято в срок")).toBeTruthy();
	});

	it("закрытие с нерешёнными кандидатами — повтор с подтверждением (force)", async () => {
		api.closeBonusMonth
			.mockRejectedValueOnce({ response: { status: 409, data: { code: "NEEDS_CONFIRMATION", pending: 1 } } })
			.mockResolvedValueOnce({ success: true });
		setup();
		await screen.findByText(translate("bonusNo"));
		fireEvent.click(screen.getByRole("button", { name: translate("bonusCloseMonth") }));
		await waitFor(() => expect(api.closeBonusMonth).toHaveBeenCalledTimes(2));
		expect(api.closeBonusMonth.mock.calls[0]).toEqual([expect.stringMatching(/^\d{4}-\d{2}$/)]);
		expect(api.closeBonusMonth.mock.calls[1]).toEqual([expect.stringMatching(/^\d{4}-\d{2}$/), true]);
	});
});
