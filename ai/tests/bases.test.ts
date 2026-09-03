// E15/A1-A2: маршрутизация «база → сервер → агент» и троттлинг полного среза по базам.
//
// Без сети и без PostgreSQL: подставляем заглушку пула, которая отвечает по тексту запроса.
// Проверяется именно РЕШЕНИЕ (кому уйдёт команда), а не SQL — ошибка здесь means команда
// выполнится не в той базе или не тем агентом, и заметят это уже по последствиям.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db/pool.ts";
import { AgentService, type AgentRole } from "../src/agents/service.ts";
import { needsFullBases } from "../src/bases/service.ts";

type FakeAgent = {
	id: string;
	organization_uuid: string;
	server_id: string | null;
	role: AgentRole;
	last_seen_at: Date | null;
	disabled_at: Date | null;
};

function row(a: Partial<FakeAgent> & { id: string }) {
	return {
		organization_uuid: "org-1",
		server_id: null,
		role: "business" as AgentRole,
		bases_synced_at: null,
		name: a.id,
		version: "1.0.0",
		os: "windows",
		capabilities: [],
		status: "ONLINE",
		onec_reachable: true,
		onec_version: "8.3.25",
		last_seen_at: new Date(),
		registered_at: new Date(),
		disabled_at: null,
		created_at: new Date(),
		...a,
	};
}

/** Заглушка пула: агенты из списка, базы из карты «ключ → сервер». */
function fakeDb(agents: ReturnType<typeof row>[], bases: Record<string, string> = {}): Db {
	return {
		query: async (sql: string, params?: unknown[]) => {
			if (sql.includes("FROM bases b JOIN servers s")) {
				const key = String(params?.[1] ?? "");
				const serverId = bases[key];
				return { rows: serverId ? [{ server_id: serverId }] : [], rowCount: serverId ? 1 : 0 };
			}
			if (sql.includes("FROM agents WHERE organization_uuid")) {
				const org = String(params?.[0] ?? "");
				return { rows: agents.filter((a) => a.organization_uuid === org), rowCount: 0 };
			}
			if (sql.includes("FROM agents ORDER BY created_at")) return { rows: agents, rowCount: 0 };
			return { rows: [], rowCount: 0 };
		},
	} as unknown as Db;
}

test("роль обязательна: админ-команда не уходит бизнес-агенту и наоборот", async () => {
	const svc = new AgentService(fakeDb([
		row({ id: "biz", role: "business" }),
		row({ id: "adm", role: "admin" }),
	]), 90);

	assert.equal((await svc.pickAgentFor("org-1", null, "business"))?.id, "biz");
	assert.equal((await svc.pickAgentFor("org-1", null, "admin"))?.id, "adm");
});

test("нет агента нужной роли — команда не ставится вовсе, а не уходит «хоть кому-то»", async () => {
	const svc = new AgentService(fakeDb([row({ id: "biz", role: "business" })]), 90);
	assert.equal(await svc.pickAgentFor("org-1", null, "admin"), null);
});

test("база выбирает сервер, сервер — агента: команда не уходит на чужой сервер", async () => {
	const svc = new AgentService(fakeDb(
		[
			row({ id: "agent-s1", server_id: "srv-1" }),
			row({ id: "agent-s2", server_id: "srv-2" }),
		],
		{ "buh-client-A": "srv-2" },
	), 90);

	assert.equal((await svc.pickAgentFor("org-1", "buh-client-A", "business"))?.id, "agent-s2");
});

test("неизвестная база — null: выполнять «где-нибудь» нельзя", async () => {
	const svc = new AgentService(fakeDb([row({ id: "agent-s1", server_id: "srv-1" })], {}), 90);
	assert.equal(await svc.pickAgentFor("org-1", "нет-такой-базы", "business"), null);
});

test("псевдо-база default = обращение без базы: агент протокола v1 продолжает работать", async () => {
	const svc = new AgentService(fakeDb([row({ id: "old", server_id: null })]), 90);
	assert.equal((await svc.pickAgentFor("org-1", "default", "business"))?.id, "old");
	assert.equal((await svc.pickOnline("org-1"))?.id, "old");
});

test("офлайн и отключённые агенты в выборе не участвуют", async () => {
	const давно = new Date(Date.now() - 10 * 60 * 1000);
	const svc = new AgentService(fakeDb([
		row({ id: "offline", last_seen_at: давно }),
		row({ id: "disabled", disabled_at: new Date() }),
	]), 90);
	assert.equal(await svc.pickAgentFor("org-1", null, "business"), null);
});

test("режим any: чужой агент берётся только при обращении без базы", async () => {
	const агенты = [row({ id: "чужой", organization_uuid: "org-2", server_id: "srv-9" })];
	const svc = new AgentService(fakeDb(агенты, { "база-org1": "srv-1" }), 90, "any");

	// Без базы — прежнее поведение одиночного стенда: берём любого онлайн-агента.
	assert.equal((await svc.pickAgentFor("org-1", null, "business"))?.id, "чужой");
	// С базой — нет: база принадлежит серверу своей организации, и подмена молча увела бы
	// команду в чужую базу. Ровно то, от чего предупреждает ТЗ (AGENT_ORG_BINDING).
	assert.equal(await svc.pickAgentFor("org-1", "база-org1", "business"), null);
});

test("полный срез по базам: нужен при первом heartbeat и по истечении интервала", () => {
	const сейчас = Date.now();
	assert.equal(needsFullBases(null, 300, сейчас), true);
	assert.equal(needsFullBases(new Date(сейчас - 60_000), 300, сейчас), false);
	assert.equal(needsFullBases(new Date(сейчас - 301_000), 300, сейчас), true);
});
