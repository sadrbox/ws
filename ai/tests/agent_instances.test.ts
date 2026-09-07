// E15: единственность экземпляра агента.
//
// Смысл проверок: ошибка здесь означает либо двух работающих агентов под одним токеном
// (команды отказывают через раз, и разбор занимает часы), либо агента, который после
// перезапуска не может вернуться к работе вовсе.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideInstance, instanceConflictMessage } from "../src/agents/instances.ts";

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
