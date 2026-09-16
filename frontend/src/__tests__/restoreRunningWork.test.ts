/**
 * Восстановление идущей работы: одна команда поднимается один раз и даёт один итог, сколько бы раз ни вызвали.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("src/services/onec/api", async (orig) => {
	const real = await orig<typeof import("src/services/onec/api")>();
	return {
		...real,
		fetchMyWork: vi.fn(() => Promise.resolve({
			commands: [{ commandId: "cmd_users", type: "IB_LIST_USERS", title: "Пользователи базы", operation: "READ",
				baseKey: "_transition", state: "dispatched", createdAt: new Date(Date.now() - 20_000).toISOString(), dispatchedAt: null }],
			batches: [],
		})),
		followCommand: vi.fn(() => new Promise(() => {})),
	};
});

import { restoreRunningWork } from "src/models/OneCAdmin/progress";
import { finishOp, getOps, resetOps } from "src/components/TechMessages/operations";
import { getMessages, setTechMessagesOwner } from "src/components/TechMessages/store";

describe("restoreRunningWork", () => {
	afterEach(() => { resetOps(); setTechMessagesOwner(null); });

	it("три вызова подряд (повторный монтаж оболочки) — одна операция и один итог", async () => {
		setTechMessagesOwner("user-restore");
		await Promise.all([restoreRunningWork(), restoreRunningWork(), restoreRunningWork()]);
		await restoreRunningWork();
		const ops = getOps().filter((o) => o.command?.id === "cmd_users");
		expect(ops).toHaveLength(1);

		finishOp(ops[0].id);
		// Уже завершённая команда при следующем вызове не поднимается снова.
		await restoreRunningWork();
		expect(getOps().filter((o) => o.command?.id === "cmd_users")).toHaveLength(1);
		expect(getMessages().filter((m) => m.text.startsWith("Пользователи базы")).length).toBeLessThanOrEqual(1);
	});
});
