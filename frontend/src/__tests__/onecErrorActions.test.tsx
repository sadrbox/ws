/**
 * П25: кнопки у отказа «база занята» — «Повторить» и «Показать сеансы».
 *
 * Смысл проверок: повтор предлагается только там, где сервис назвал отказ повторимым (иначе кнопка обещает
 * бессмысленное), а «Показать сеансы» ведёт в карточку базы на вкладку сеансов и несёт НОМЕР сеанса —
 * снимают сеанс уже там, по строке, потому что команде кластера нужен UUID.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { TestWrapper } from "./utils/TestWrapper";
import { useOnecErrorActions } from "src/models/OneCAdmin/shared";
import { takeBaseTab } from "src/models/OneCBases/openAt";

const busy = {
	retryable: true,
	details: { lockedBy: { computer: "SERVER", sessionId: "2", appId: "Фоновое задание" } },
};

// Открыватель карточки базы читает кэш реестра — значит, нужен и QueryClient.
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const Wrapper = ({ children }: PropsWithChildren) => (
	<QueryClientProvider client={qc}><TestWrapper>{children}</TestWrapper></QueryClientProvider>
);

const build = () => renderHook(() => useOnecErrorActions(), { wrapper: Wrapper }).result.current;

describe("кнопки у отказа команды 1С", () => {
	it("база занята и есть что повторить — обе кнопки", () => {
		const retry = vi.fn();
		const actions = build()(busy, { baseKey: "_transition", retry });
		expect(actions.map((a) => a.label)).toEqual(["Повторить", "Показать сеансы"]);
		void actions[0].onClick();
		expect(retry).toHaveBeenCalledTimes(1);
	});

	it("«Показать сеансы» просит карточку открыться на сеансах и несёт номер держателя", () => {
		const actions = build()(busy, { baseKey: "_transition" });
		void actions[0].onClick();
		expect(takeBaseTab("_transition")).toEqual({ tab: "sessions", session: "2" });
		// Просьба одноразовая: карточка забрала её и второй раз не откроется сама собой.
		expect(takeBaseTab("_transition")).toBeNull();
	});

	it("отказ не повторим — «Повторить» не предлагаем", () => {
		const actions = build()({ retryable: false, details: { lockedBy: { sessionId: "7" } } },
			{ baseKey: "b", retry: () => {} });
		expect(actions.map((a) => a.label)).toEqual(["Показать сеансы"]);
	});

	it("база неизвестна или отказ не про занятость — кнопок нет", () => {
		expect(build()({ retryable: true }, { retry: () => {} }).map((a) => a.label)).toEqual(["Повторить"]);
		expect(build()({ code: "IB_USER_DUPLICATE" }, { baseKey: "b", retry: () => {} })).toEqual([]);
	});
});
