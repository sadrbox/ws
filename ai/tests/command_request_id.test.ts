/**
 * Повтор присоединяется к идущей команде: чтения и долгие изменения по базе (С8, аудит 14.09).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commandRequestId, findAdminCommand } from "../src/commands/admin.ts";

describe("ключ склейки повторов", () => {
	it("чтение — всегда по базе", () => {
		assert.equal(commandRequestId(findAdminCommand("IB_LIST_USERS")!, { baseKey: "b" }, "b"), "IB_LIST_USERS:b");
	});

	it("загрузка, обновление и проверка базы — склеиваются по базе", () => {
		for (const t of ["IB_RESTORE", "IB_APPLY_UPDATE", "IB_CHECK"]) {
			assert.equal(commandRequestId(findAdminCommand(t)!, { baseKey: "b", path: "x" }, "b"), `${t}:b`);
		}
	});

	it("сухой прогон не склеивается — он ничего не меняет и короткий", () => {
		assert.equal(commandRequestId(findAdminCommand("IB_RESTORE")!, { baseKey: "b", dryRun: true }, "b"), undefined);
	});

	it("обычные изменения не склеиваются: повтор — законное намерение", () => {
		assert.equal(commandRequestId(findAdminCommand("IB_UPDATE_USER")!, { baseKey: "b", name: "u" }, "b"), undefined);
		assert.equal(commandRequestId(findAdminCommand("CLUSTER_TERMINATE_SESSION")!, { sessionId: "s" }, null), undefined);
	});
});
