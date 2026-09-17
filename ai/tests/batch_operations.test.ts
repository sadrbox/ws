// «Операции» списка баз (17.09): «Обновить сведения» и запрет/разрешение регламентных заданий — групповыми
// заданиями по отмеченным базам.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isDestructive } from "../src/onec/access.ts";
import { BATCHABLE, startBatch, type BatchDeps } from "../src/onec/batchRunner.ts";

test("сведения о базе и регламентные задания ставятся заданием", () => {
	assert.ok(BATCHABLE.has("IB_INFO"));
	assert.ok(BATCHABLE.has("CLUSTER_SET_SCHEDULED_JOBS"));
});

test("задание «Обновить сведения» — чтение; изменяющие задания — нет", () => {
	assert.equal(isDestructive("POST", "/batch", { type: "IB_INFO", baseKeys: ["a"] }), false);
	assert.equal(isDestructive("POST", "/batch", { type: "ib_info", baseKeys: ["a"] }), false);
	assert.equal(isDestructive("POST", "/batch", { type: "CLUSTER_SET_SCHEDULED_JOBS", baseKeys: ["a"] }), true);
	assert.equal(isDestructive("POST", "/batch", { type: "IB_PUBLISH", baseKeys: ["a"] }), true);
	assert.equal(isDestructive("POST", "/batch", {}), true);
});

function deps(bases: Record<string, { disabled: boolean; clusterStatus: string }>) {
	const enqueued: { baseKey: string; type: string; payload: unknown; inBase: boolean }[] = [];
	let skipped: { baseKey: string; reason: string }[] = [];
	const d = {
		agents: {
			pickAdminAgent: async () => ({
				id: "adm", organizationUuid: "org-1", role: "admin", disabled: false,
				capabilities: ["cluster.admin", "ib.admin", "CLUSTER_SET_SCHEDULED_JOBS", "IB_INFO", "CLUSTER_DROP_INFOBASE"],
			}),
		},
		queue: {
			enqueue: async (i: { baseKey: string; type: string; payload: unknown; inBase: boolean }) => {
				enqueued.push(i);
				return { id: `cmd-${enqueued.length}` };
			},
		},
		batches: {
			create: async () => "batch-1",
			attach: async () => {},
			noteSkipped: async (_id: string, s: { baseKey: string; reason: string }[]) => { skipped = s; },
		},
		bases: { findByKeyGlobal: async (key: string) => (bases[key] ? { key, ...bases[key] } : null) },
	} as unknown as BatchDeps;
	return { d, enqueued, skipped: () => skipped };
}

test("запрет регламентных заданий: по каждой базе своя команда, место базы не занимается; скрытой — тоже", async () => {
	const t = deps({ a: { disabled: false, clusterStatus: "ONLINE" }, hidden: { disabled: true, clusterStatus: "ONLINE" } });
	const r = await startBatch(t.d, {
		type: "CLUSTER_SET_SCHEDULED_JOBS", baseKeys: ["a", "hidden"], payload: { denied: true },
		organizationUuid: "org-1", userUuid: "u1",
	});
	assert.ok(!("error" in r));
	assert.equal(r.queued, 2);
	assert.deepEqual(t.enqueued.map((e) => [e.baseKey, e.inBase, (e.payload as { denied: boolean }).denied]), [["a", false, true], ["hidden", false, true]]);
});

test("«Обновить сведения»: скрытая база и база без регистрации в кластере отсеиваются с причиной", async () => {
	const t = deps({
		a: { disabled: false, clusterStatus: "ONLINE" },
		hidden: { disabled: true, clusterStatus: "ONLINE" },
		gone: { disabled: false, clusterStatus: "MISSING" },
	});
	const r = await startBatch(t.d, { type: "IB_INFO", baseKeys: ["a", "hidden", "gone"], organizationUuid: "org-1", userUuid: "u1" });
	assert.ok(!("error" in r));
	assert.equal(r.queued, 1);
	assert.equal(t.enqueued[0].inBase, true);
	assert.deepEqual(t.skipped().map((s) => s.baseKey), ["hidden", "gone"]);
});

test("удаление регистрации — групповым заданием, только с confirm: true и не для базы, которой уже нет в кластере", async () => {
	assert.ok(BATCHABLE.has("CLUSTER_DROP_INFOBASE"));
	assert.equal(isDestructive("POST", "/batch", { type: "CLUSTER_DROP_INFOBASE", baseKeys: ["a"] }), true);

	const noConfirm = deps({ a: { disabled: false, clusterStatus: "ONLINE" } });
	const refused = await startBatch(noConfirm.d, { type: "CLUSTER_DROP_INFOBASE", baseKeys: ["a"], organizationUuid: "org-1", userUuid: "u1" });
	assert.ok("error" in refused, "без confirm задание не ставится вовсе");

	const t = deps({
		phantom: { disabled: true, clusterStatus: "ONLINE" },
		gone: { disabled: false, clusterStatus: "MISSING" },
	});
	const r = await startBatch(t.d, {
		type: "CLUSTER_DROP_INFOBASE", baseKeys: ["phantom", "gone"], payload: { confirm: true },
		organizationUuid: "org-1", userUuid: "u1",
	});
	assert.ok(!("error" in r));
	assert.deepEqual(t.enqueued.map((e) => [e.baseKey, e.inBase]), [["phantom", false]]);
	assert.deepEqual(t.skipped().map((s) => s.baseKey), ["gone"]);
});
