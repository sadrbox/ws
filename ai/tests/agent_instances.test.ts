// E15: единственность экземпляра агента.
//
// Смысл проверок: ошибка здесь означает либо двух работающих агентов под одним токеном
// (команды отказывают через раз, и разбор занимает часы), либо агента, который после
// перезапуска не может вернуться к работе вовсе.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideInstance, instanceConflictMessage } from "../src/agents/instances.ts";
import type { Db } from "../src/db/pool.ts";
import { AgentService } from "../src/agents/service.ts";

const now = new Date("2026-09-07T12:00:00Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

test("владельца нет — первый пришедший его получает", () => {
	assert.deepEqual(
		decideInstance({ ownerInstanceId: null, ownerSeenAt: null, incomingInstanceId: "SERVER#5692", now, offlineAfterSecs: 120 }),
		{ kind: "claim" },
	);
});

test("пришёл владелец — просто продлеваем, а не отказываем ему же", () => {
	assert.deepEqual(
		decideInstance({ ownerInstanceId: "SERVER#5692", ownerSeenAt: secondsAgo(5), incomingInstanceId: "SERVER#5692", now, offlineAfterSecs: 120 }),
		{ kind: "refresh" },
	);
});

test("второй экземпляр при живом владельце получает отказ", () => {
	const d = decideInstance({
		ownerInstanceId: "SERVER#5692", ownerSeenAt: secondsAgo(10),
		incomingInstanceId: "X57#3316", now, offlineAfterSecs: 120,
	});
	assert.equal(d.kind, "reject");
	assert.equal(d.kind === "reject" && d.ownerInstanceId, "SERVER#5692");
	assert.equal(d.kind === "reject" && d.ownerSeenSecsAgo, 10);
});

test("молчащий владелец уступает место: иначе перезапуск службы закрыл бы дорогу навсегда", () => {
	// Новый pid после перезапуска = другой идентификатор, и прежний владелец уже не придёт.
	assert.deepEqual(
		decideInstance({ ownerInstanceId: "SERVER#5692", ownerSeenAt: secondsAgo(600), incomingInstanceId: "SERVER#7001", now, offlineAfterSecs: 120 }),
		{ kind: "claim" },
	);
	// Владелец записан, но когда его видели — неизвестно: считаем ушедшим, а не вечным.
	assert.deepEqual(
		decideInstance({ ownerInstanceId: "SERVER#5692", ownerSeenAt: null, incomingInstanceId: "X57#1", now, offlineAfterSecs: 120 }),
		{ kind: "claim" },
	);
});

test("в отказе названы владелец и давность — иначе искать нечего", () => {
	const msg = instanceConflictMessage("SERVER#5692", 7);
	assert.match(msg, /SERVER#5692/);
	assert.match(msg, /7 с назад/);
	assert.match(msg, /отдельного агента/);
});

// ── Перезапуск службы: панель обязана узнать об этом немедленно ─────────────
//
// ЖИВОЙ СЛУЧАЙ (12.09, тестирование). Агента остановили — панель показывала «на связи» и
// предлагала снимать процессы; агента запустили заново — панель по-прежнему показывала
// снимок процессов ПРЕЖНЕГО экземпляра. Человек жал «Снять процесс» и получал честный
// отказ агента: «процесса 10040 нет среди запущенных агентом». Ответ был верным, вопрос —
// нет: список принадлежал покойнику.
//
// Здесь проверяется механика, которая это чинит: появление НОВОГО экземпляра стирает снимок
// процессов и признак занятости, доставшиеся от прежнего.

test("новый экземпляр стирает снимок процессов прежнего", async () => {
	const seen: { sql: string; params: unknown[] }[] = [];
	const db = {
		query: async (sql: string, params?: unknown[]) => {
			seen.push({ sql, params: params ?? [] });
			// INSERT ... RETURNING (xmax = 0): true — строка вставлена, экземпляр новый.
			if (sql.includes("INSERT INTO agent_instances")) return { rows: [{ inserted: true }], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		},
		connect: async () => { throw new Error("не нужен"); },
	} as unknown as Db;

	const agents = new AgentService(db, 90);
	await agents.touchInstance("agent-1", "SERVER/BPAPIAgentAdmin/9212/2026-09-12T13:09:04Z", "0.1.0", "10.0.0.1");

	const wipe = seen.find((q) => q.sql.includes("processes = '[]'::jsonb"));
	assert.ok(wipe, "снимок процессов прежнего экземпляра должен быть стёрт");
	assert.deepEqual(wipe?.params, ["agent-1"]);
});

test("тот же экземпляр снимок не трогает: это его собственные процессы", async () => {
	const seen: string[] = [];
	const db = {
		query: async (sql: string) => {
			seen.push(sql);
			// xmax <> 0 — строка обновлена: экземпляр тот же, что и был.
			if (sql.includes("INSERT INTO agent_instances")) return { rows: [{ inserted: false }], rowCount: 1 };
			return { rows: [], rowCount: 0 };
		},
		connect: async () => { throw new Error("не нужен"); },
	} as unknown as Db;

	const agents = new AgentService(db, 90);
	await agents.touchInstance("agent-1", "SERVER/BPAPIAgentAdmin/9212/2026-09-12T13:09:04Z", "0.1.0", "10.0.0.1");
	assert.ok(!seen.some((sql) => sql.includes("processes = '[]'::jsonb")));
});
