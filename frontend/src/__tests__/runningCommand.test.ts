/**
 * Кнопка знает свою идущую работу по типу команды и базе — в том числе восстановленную после перезагрузки страницы.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { finishOp, resetOps, startOp, useRunningCommand } from "src/components/TechMessages/operations";

describe("useRunningCommand", () => {
	afterEach(() => resetOps());

	it("занято, пока идёт команда этого типа по этой базе; после итога — свободно", () => {
		let id = "";
		act(() => {
			id = startOp({ kind: "update", title: "Запрет регламентных заданий", target: "shahs", total: 1,
				command: { type: "CLUSTER_SET_SCHEDULED_JOBS", baseKey: "shahs" } });
		});
		const same = renderHook(() => useRunningCommand(["CLUSTER_SET_SCHEDULED_JOBS"], "SHAHS"));
		const other = renderHook(() => useRunningCommand(["CLUSTER_SET_SCHEDULED_JOBS"], "_transition"));
		const anyBase = renderHook(() => useRunningCommand(["CLUSTER_SET_SCHEDULED_JOBS"]));
		expect(same.result.current).toBe(true);
		expect(other.result.current).toBe(false);
		expect(anyBase.result.current).toBe(true);

		act(() => finishOp(id));
		same.rerender();
		expect(same.result.current).toBe(false);
	});
});
