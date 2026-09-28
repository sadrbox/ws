// Модель агента без владельца (28.09, docs/TASK_SERVICE_AGENT_OWNER_MODEL_2026-09-28.md): AgentService целиком —
// исполнитель бизнес-команды по БИН среди ВСЕХ бизнес-агентов, свои базы организации, объяснение отказа, агент для
// базы реестра и «кто обслуживает» для статуса чата. Правило выбора само по себе — в agent_bases_limits.test.ts.
//
// Живой случай: ТОО «SHAHS» — база `shahs` на сервере фирмы, бизнес-агент одобрен без организации. Раньше карточка
// клиента отвечала «некому спросить», потому что исполнителя искали среди агентов организации клиента.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db/pool.ts";
import { AgentService, type AgentRole } from "../src/agents/service.ts";

const CLIENT = "client-org";
const BIN = "001040001278";
const OTHER_BIN = "831111302342";

type SliceRow = { key: string; organizations: { id: string; name: string; bin: string }[] | null };

function agentRow(a: { id: string; role?: AgentRole; name?: string; disabled?: boolean; online?: boolean }) {
	return {
		server_id: null, role: a.role ?? "business", bases_synced_at: null, name: a.name ?? a.id, version: "1.0.0", os: "windows",
		capabilities: [], status: "ONLINE", onec_reachable: true, onec_version: "8.3.25",
		last_seen_at: a.online === false ? new Date(Date.now() - 3_600_000) : new Date(), registered_at: new Date(),
		disabled_at: a.disabled ? new Date() : null, created_at: new Date(), id: a.id,
	};
}

/** Заглушка пула: агенты, их срезы, свои базы организации (заявки и токены), одобренные БИН баз реестра. */
function fakeDb(o: {
	agents: ReturnType<typeof agentRow>[]; slices: Record<string, SliceRow[]>;
	owned?: { key: string; server_id: string }[]; baseBins?: Record<string, string[]>;
}): Db {
	return {
		query: async (sql: string, params?: unknown[]) => {
			if (sql.includes("FROM agent_bases")) {
				const ids = (params?.[0] ?? []) as string[];
				const rows = ids.flatMap((id) => (o.slices[id] ?? []).map((b, pos) => ({
					agent_id: id, key: b.key, pos, status: "ONLINE", transport: "com", ext_version: null, over_limit: null,
					organizations: b.organizations, seen_at: new Date(),
				})));
				return { rows, rowCount: rows.length };
			}
			if (sql.includes("FROM base_organizations o JOIN bases b")) return { rows: o.owned ?? [], rowCount: (o.owned ?? []).length };
			if (sql.includes("SELECT bin FROM base_organizations")) {
				const rows = (o.baseBins?.[String(params?.[0])] ?? []).map((bin) => ({ bin }));
				return { rows, rowCount: rows.length };
			}
			if (sql.includes("FROM agents ORDER BY created_at")) return { rows: o.agents, rowCount: o.agents.length };
			return { rows: [], rowCount: 0 };
		},
	} as unknown as Db;
}

const shahs = (id: string, bin = BIN): SliceRow => ({ key: "shahs", organizations: [{ id, name: "ТОО SHAHS", bin }] });

test("SHAHS: базу клиента обслуживает любой бизнес-агент, у которого она есть, — без организации агента", async () => {
	const svc = new AgentService(fakeDb({
		agents: [agentRow({ id: "t1-adm", role: "admin" }), agentRow({ id: "t1-biz", name: "Сервер, бизнес" })],
		slices: { "t1-biz": [{ key: "Dev_01", organizations: [{ id: "y", name: "ИП", bin: OTHER_BIN }] }, shahs("x")] },
	}), 90);
	const r = await svc.resolveBusiness(CLIENT, BIN);
	assert.equal(r.kind === "agent" && r.agent.id, "t1-biz");
	assert.equal(r.kind === "agent" && r.baseKey, "shahs");
	assert.deepEqual(r.kind === "agent" ? r.baseOrgs?.map((o) => o.bin) : [], [BIN]);
	// Агент кластера бизнес-команды не получает никогда.
	assert.equal((await new AgentService(fakeDb({ agents: [agentRow({ id: "t1b-adm", role: "admin" })], slices: { "t1b-adm": [shahs("x")] } }), 90)
		.resolveBusiness(CLIENT, BIN)).kind, "none");
});

test("копия базы у другого агента: своя база организации (заявка или токен) — туда, иначе BASE_AMBIGUOUS с перечнем", async () => {
	const agents = [agentRow({ id: "t2-firm", name: "Фирма" }), agentRow({ id: "t2-old", name: "Прежняя фирма" })];
	const slices = { "t2-firm": [shahs("x")], "t2-old": [{ ...shahs("x"), key: "shahs_2025" }] };
	const none = await new AgentService(fakeDb({ agents, slices }), 90).resolveBusiness(CLIENT, BIN);
	assert.equal(none.kind, "ambiguous");
	assert.match(none.kind === "ambiguous" ? none.message : "", /«shahs» \(агент «Фирма»\).*«shahs_2025» \(агент «Прежняя фирма»\).*Подключите нужную базу/);

	const own = await new AgentService(fakeDb({ agents, slices, owned: [{ key: "shahs", server_id: "srv" }] }), 90).resolveBusiness(CLIENT, BIN);
	assert.equal(own.kind === "agent" && own.agent.id, "t2-firm");
});

test("отключённый агент не кандидат; объяснение отказа — нет базы, агент отключён, агент не на связи", async () => {
	const nowhere = new AgentService(fakeDb({ agents: [agentRow({ id: "t3-biz" })], slices: { "t3-biz": [shahs("x", OTHER_BIN)] } }), 90);
	assert.equal((await nowhere.resolveBusiness(CLIENT, BIN)).kind, "none");
	const why = await nowhere.explainUnresolved(BIN, "ТОО SHAHS");
	assert.equal(why.code, "BASE_NOT_SERVED");
	assert.match(why.message, /нет ни в одной базе агентов BuhProf/);

	const disabled = new AgentService(fakeDb({ agents: [agentRow({ id: "t4-biz", name: "Сервер", disabled: true })], slices: { "t4-biz": [shahs("x")] } }), 90);
	assert.equal((await disabled.resolveBusiness(CLIENT, BIN)).kind, "none");
	assert.equal((await disabled.explainUnresolved(BIN, "ТОО SHAHS")).code, "AGENT_DISABLED");

	// Не на связи — кандидат есть (вызывающий ответит AGENT_OFFLINE), объяснение то же.
	const offline = new AgentService(fakeDb({ agents: [agentRow({ id: "t5-biz", name: "Сервер", online: false })], slices: { "t5-biz": [shahs("x")] } }), 90);
	const r = await offline.resolveBusiness(CLIENT, BIN);
	assert.equal(r.kind === "agent" && r.agent.online, false);
	assert.equal((await offline.explainUnresolved(BIN, "ТОО SHAHS")).code, "AGENT_OFFLINE");
});

test("кто обслуживает организацию (статус чата, список агентов клиента): агент и ТОЛЬКО базы с её БИН", async () => {
	const svc = new AgentService(fakeDb({
		agents: [agentRow({ id: "t6-biz" }), agentRow({ id: "t6-other" })],
		slices: { "t6-biz": [{ key: "Чужая", organizations: [{ id: "z", name: "Другой клиент", bin: OTHER_BIN }] }, shahs("x")], "t6-other": [] },
	}), 90);
	const serving = await svc.servingBin(BIN);
	assert.deepEqual(serving.map((s) => [s.agent.id, s.bases.map((b) => b.key)]), [["t6-biz", ["shahs"]]]);
	assert.deepEqual(await svc.servingBin(null), []);
});

test("база реестра (самопроверка): агент по одобренным БИН базы и её ключу; без одобренных БИН — никто", async () => {
	const svc = new AgentService(fakeDb({
		agents: [agentRow({ id: "t7-biz" })], slices: { "t7-biz": [shahs("x")] }, baseBins: { "base-1": [BIN] },
	}), 90);
	const d = await svc.resolveForBase("base-1", "shahs");
	assert.equal(d.kind === "agent" && d.agent.id, "t7-biz");
	assert.equal((await svc.resolveForBase("base-2", "shahs")).kind, "none");
	// Под тем же ключом у агента другая организация — не эта база.
	const foreign = new AgentService(fakeDb({ agents: [agentRow({ id: "t8-biz" })], slices: { "t8-biz": [shahs("x", OTHER_BIN)] }, baseBins: { "base-1": [BIN] } }), 90);
	assert.equal((await foreign.resolveForBase("base-1", "shahs")).kind, "none");
});
