// С44/С45 (17.09): скрытая база и база, которой нет в кластере.
//
// ЖИВОЙ СЛУЧАЙ. nomadstroygroup скрыли, потом удалили её регистрацию из кластера. Панель показывала базу, а любая
// команда — и «Вернуть в работу», и «Удалить регистрацию» — отвечала за доли секунды «базы нет в реестре — обновите
// список»: поиск по ключу скрытые не находил, а обновление списка ничего не меняло.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db/pool.ts";
import { AgentService } from "../src/agents/service.ts";
import { BaseService } from "../src/bases/service.ts";
import { baseRefusal, findAdminCommand } from "../src/commands/admin.ts";
import { isDestructive } from "../src/onec/access.ts";
import { startBatch, type BatchDeps } from "../src/onec/batchRunner.ts";

const spec = (type: string) => {
	const s = findAdminCommand(type);
	assert.ok(s, type);
	return s;
};
const base = (over: Partial<{ key: string; disabled: boolean; clusterStatus: string }> = {}) =>
	({ key: "nomadstroygroup", disabled: false, clusterStatus: "ONLINE", ...over });

test("скрытая база: внутрь неё команды не идут, с отказом BASE_HIDDEN, а не «нет в реестре»", () => {
	const r = baseRefusal(spec("IB_LIST_USERS"), base({ disabled: true }));
	assert.equal(r?.code, "BASE_HIDDEN");
	assert.equal(r?.status, 409);
	assert.match(r!.message, /скрыта из работы/);
	assert.match(r!.message, /верните/);
});

test("скрытая база: кластерные команды идут — именно они её лечат", () => {
	assert.equal(baseRefusal(spec("CLUSTER_DROP_INFOBASE"), base({ disabled: true })), null);
	assert.equal(baseRefusal(spec("CLUSTER_SET_SESSIONS_LOCK"), base({ disabled: true })), null);
});

test("базы нет в кластере: ни одной команды, и удалить регистрацию тоже нельзя — её нет", () => {
	for (const type of ["CLUSTER_DROP_INFOBASE", "CLUSTER_SET_SESSIONS_LOCK", "IB_LIST_USERS"]) {
		const r = baseRefusal(spec(type), base({ clusterStatus: "MISSING", disabled: true }));
		assert.equal(r?.code, "BASE_NOT_IN_CLUSTER", type);
		assert.match(r!.message, /Уберите её из списка/);
	}
});

test("рабочая база — без отказа", () => {
	assert.equal(baseRefusal(spec("IB_LIST_USERS"), base()), null);
	assert.equal(baseRefusal(spec("CLUSTER_DROP_INFOBASE"), base()), null);
});

test("«убрать из реестра» — разрушающее; чтения того же вида остаются чтениями", () => {
	assert.equal(isDestructive("DELETE", "/bases/nomadstroygroup"), true);
	assert.equal(isDestructive("GET", "/bases/nomadstroygroup"), false);
	assert.equal(isDestructive("POST", "/bases/refresh"), false);
});

/** Заглушка пула, в которой база СКРЫТА: находится только запросом, который скрытые не отбрасывает. */
function hiddenBaseDb(): Db {
	const hiddenRow = {
		id: "b1", server_id: "srv-1", server_name: "SERVER", public_host: null, key: "nomadstroygroup", name: "nomad",
		status: "MISSING", disabled_at: new Date(), extension_names: [],
	};
	return {
		query: async (sql: string) => {
			const filtersHidden = /disabled_at IS NULL/.test(sql);
			if (sql.includes("SELECT b.server_id FROM bases b")) {
				return filtersHidden ? { rows: [], rowCount: 0 } : { rows: [{ server_id: "srv-1" }], rowCount: 1 };
			}
			if (sql.includes("FROM bases b JOIN servers s") && sql.includes("b.key = $1")) {
				return filtersHidden ? { rows: [], rowCount: 0 } : { rows: [hiddenRow], rowCount: 1 };
			}
			if (sql.includes("FROM agents ORDER BY created_at")) {
				return {
					rows: [{
						id: "adm", organization_uuid: "org-1", server_id: "srv-1", role: "admin", bases_synced_at: null, name: "adm",
						version: "1", os: "windows", capabilities: ["cluster.admin"], status: "ONLINE", onec_reachable: true,
						onec_version: "8.3", last_seen_at: new Date(), registered_at: new Date(), disabled_at: null, created_at: new Date(),
					}],
					rowCount: 1,
				};
			}
			return { rows: [], rowCount: 0 };
		},
	} as unknown as Db;
}

test("поиск по ключу находит скрытую базу и отдаёт статус кластера отдельно от скрытия", async () => {
	const found = await new BaseService(hiddenBaseDb()).findByKeyGlobal("nomadstroygroup");
	assert.ok(found, "скрытая база должна находиться");
	assert.equal(found.disabled, true);
	assert.equal(found.status, "DISABLED");
	assert.equal(found.clusterStatus, "MISSING");
});

test("у скрытой базы есть исполнитель: кластерной команде есть кому уйти", async () => {
	const agent = await new AgentService(hiddenBaseDb(), 90).pickAdminAgent("nomadstroygroup");
	assert.equal(agent?.id, "adm");
});

test("групповое задание отсеивает скрытую базу с причиной, а не «нет агента на связи»", async () => {
	let skippedNoted: { baseKey: string; reason: string }[] = [];
	const deps = {
		agents: { pickAdminAgent: async () => { throw new Error("до выбора агента дойти не должно"); } },
		queue: { enqueue: async () => { throw new Error("в очередь ставить нельзя"); } },
		batches: {
			create: async () => "batch-1",
			attach: async () => {},
			noteSkipped: async (_id: string, s: { baseKey: string; reason: string }[]) => { skippedNoted = s; },
		},
		bases: { findByKeyGlobal: async (key: string) => ({ key, disabled: true, clusterStatus: "ONLINE" }) },
	} as unknown as BatchDeps;

	const r = await startBatch(deps, {
		type: "IB_DELETE_USER", baseKeys: ["hidden-base"], payload: { name: "new2" }, organizationUuid: "org-1", userUuid: "u1",
	});
	assert.ok(!("error" in r));
	assert.equal(r.queued, 0);
	assert.equal(skippedNoted.length, 1);
	assert.match(skippedNoted[0].reason, /скрыта из работы/);
});
