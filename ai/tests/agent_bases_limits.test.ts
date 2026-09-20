// Многобазовый бизнес-агент и лимит тарифа (СВ3, 19.09).
//
// Правило лимита — то же, что у агента (bpapi_agent/README.md): первые maxBases баз по порядку среза и первые
// maxBins РАЗНЫХ БИНов по порядку баз и организаций. Сервис — главный контроль: команду сверх лимита он не ставит
// в очередь вовсе. Сценарии — из раздела «Готово, когда» задачи.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentBasesStore, describeAgentBases, evaluateLimits, limitMismatches, limitsForAgent, parseLimit, resolveTarget, type AgentBase, type AgentSlice } from "../src/agents/agentBases.ts";

const base = (key: string, pos: number, bins: string[] = [], transport: "http" | "com" = "com"): AgentBase => ({
	key, pos, status: "ONLINE", transport, extVersion: "1.4.0", overLimit: null, seenAt: null,
	organizations: bins.map((bin, i) => ({ id: `${key}-org${i}`, name: `Орг ${bin}`, bin })),
});
const slice = (bases: AgentBase[], maxBases: number | null, maxBins: number | null, online = true): AgentSlice =>
	({ agentId: "a1", online, bases, limits: { maxBases, maxBins } });

test("без лимита — сверх лимита нет ничего", () => {
	const v = evaluateLimits([base("A", 0, ["111"]), base("B", 1, ["222"])], { maxBases: null, maxBins: null });
	assert.deepEqual(v.overBases, []);
	assert.deepEqual(v.overBins, []);
	assert.deepEqual(v.usage, { bases: 2, bins: 2 });
});

test("3 базы (2 COM, 1 HTTP), maxBases=2 — третья сверх лимита, команда в неё отвергается сервисом", () => {
	const bases = [base("Альфа", 0, ["111"]), base("Бета", 1, ["222"]), base("Гамма", 2, ["333"], "http")];
	const v = evaluateLimits(bases, { maxBases: 2, maxBins: null });
	assert.deepEqual(v.overBases, ["Гамма"]);

	const d = resolveTarget([slice(bases, 2, null)], { baseKey: "Гамма" });
	assert.equal(d.kind, "refused");
	assert.ok(d.kind === "refused" && /тариф: 2 базы, подключено 3/.test(d.message), d.kind === "refused" ? d.message : "");
	// Организация третьей базы тоже недоступна: её единственная база сверх лимита.
	assert.equal(resolveTarget([slice(bases, 2, null)], { bin: "333" }).kind, "refused");
});

test("maxBins=1 при двух организациях — команда по второй: LICENSE_LIMIT с текстом про тариф", () => {
	const bases = [base("Альфа", 0, ["111", "222"])];
	const v = evaluateLimits(bases, { maxBases: null, maxBins: 1 });
	assert.deepEqual(v.overBins, ["222"]);

	const ok = resolveTarget([slice(bases, null, 1)], { bin: "111" });
	assert.deepEqual(ok, { kind: "base", agentId: "a1", baseKey: "Альфа", alsoIn: [], status: "ONLINE" });

	const refused = resolveTarget([slice(bases, null, 1)], { bin: "222" });
	assert.equal(refused.kind, "refused");
	assert.ok(refused.kind === "refused" && /тариф: 1 БИН, подключено 2/.test(refused.message));
});

test("один БИН в двух базах — одна организация: считается один раз, команда в первую, вторая названа", () => {
	const bases = [base("Альфа", 0, ["111"]), base("Бета", 1, ["111", "222"])];
	const v = evaluateLimits(bases, { maxBases: null, maxBins: 2 });
	assert.deepEqual(v.usage, { bases: 2, bins: 2 });
	assert.deepEqual(v.overBins, []);
	assert.deepEqual(resolveTarget([slice(bases, null, 2)], { bin: "111" }), { kind: "base", agentId: "a1", baseKey: "Альфа", alsoIn: ["Бета"], status: "ONLINE" });
});

test("база сверх лимита баз не занимает место БИНа", () => {
	// Порядок: Альфа(111), Бета(222) — сверх maxBases=1, Гамма… БИН 222 есть только в Бете — он сверх лимита,
	// но мест под БИНы он не отнимает: лимит БИНов считается по обслуживаемым базам.
	const bases = [base("Альфа", 0, ["111"]), base("Бета", 1, ["222"])];
	const v = evaluateLimits(bases, { maxBases: 1, maxBins: 1 });
	assert.deepEqual(v.overBases, ["Бета"]);
	assert.deepEqual(v.overBins, ["222"]);
	assert.deepEqual(resolveTarget([slice(bases, 1, 1)], { bin: "111" }).kind, "base");
});

test("БИН в базе сверх лимита и в обслуживаемой — команда уходит в обслуживаемую", () => {
	const bases = [base("Альфа", 0, ["111"]), base("Бета", 1, ["222"]), base("Гамма", 2, ["222"])];
	const d = resolveTarget([slice(bases, 2, null)], { bin: "222" });
	assert.deepEqual(d, { kind: "base", agentId: "a1", baseKey: "Бета", alsoIn: ["Гамма"], status: "ONLINE" });
});

test("явный baseKey — главнее БИН; неизвестные база и БИН — прежний путь", () => {
	const bases = [base("Альфа", 0, ["111"]), base("Бета", 1, ["111"])];
	assert.deepEqual(resolveTarget([slice(bases, null, null)], { baseKey: "бета", bin: "111" }),
		{ kind: "base", agentId: "a1", baseKey: "Бета", alsoIn: [], status: "ONLINE" });
	assert.deepEqual(resolveTarget([slice(bases, null, null)], { baseKey: "нет-такой" }), { kind: "none" });
	assert.deepEqual(resolveTarget([slice(bases, null, null)], { bin: "999" }), { kind: "none" });
	// Старая сборка: организаций нет в срезе — решать нечем.
	const old = [{ ...base("Альфа", 0), organizations: null }];
	assert.deepEqual(resolveTarget([slice(old, null, null)], { bin: "111" }), { kind: "none" });
});

test("из двух агентов с тем же БИН — тот, что на связи", () => {
	const offline = { ...slice([base("Альфа", 0, ["111"])], null, null, false), agentId: "off" };
	const online = { ...slice([base("Бета", 0, ["111"])], null, null, true), agentId: "on" };
	const d = resolveTarget([offline, online], { bin: "111" });
	assert.ok(d.kind === "base" && d.agentId === "on" && d.baseKey === "Бета");
});

test("панель: 3 базы (2 COM, 1 HTTP) при maxBases=2 — третья «сверх лимита», счётчики по подключённым", () => {
	const v = describeAgentBases([base("Б1", 0, ["111111111111"]), base("Б2", 1, ["222222222222"]), base("Б3", 2, ["111111111111"], "http")], { maxBases: 2, maxBins: null });
	assert.deepEqual(v.usage, { bases: 3, bins: 2 });
	assert.deepEqual(v.bases.map((b) => [b.key, b.transport, b.overLimitService]), [["Б1", "com", false], ["Б2", "com", false], ["Б3", "http", true]]);
	// БИН в двух базах: команды уходят в первую обслуживаемую, вторая показана.
	const dup = v.bases[2].organizations![0];
	assert.deepEqual([dup.overLimit, dup.alsoIn, dup.usedBase], [true, ["Б1"], "Б1"]);
	assert.deepEqual(v.bases[0].organizations![0].alsoIn, ["Б3"]);
});

test("панель: maxBins=1 — вторая организация сверх лимита, команды в неё не уходят никуда", () => {
	const v = describeAgentBases([base("Б1", 0, ["111111111111", "222222222222"])], { maxBases: null, maxBins: 1 });
	assert.deepEqual(v.bases[0].organizations!.map((o) => [o.bin, o.overLimit, o.usedBase]), [["111111111111", false, "Б1"], ["222222222222", true, null]]);
	assert.equal(v.bases[0].overLimitService, false);
});

test("лимит из панели: целое ≥ 0 или пусто; остальное — отказ", () => {
	assert.equal(parseLimit(""), null);
	assert.equal(parseLimit(null), null);
	assert.equal(parseLimit(5), 5);
	assert.equal(parseLimit(" 7 "), 7);
	assert.equal(parseLimit(0), 0);
	for (const bad of [-1, 1.5, "abc", "1e3", true, {}]) assert.equal(parseLimit(bad), undefined, String(bad));
});

test("срез с дублем ключа: остаётся первая строка, запрос один и без повтора ключа", async () => {
	const calls: unknown[][] = [];
	const sqls: string[] = [];
	const query = async (sql: string, p: unknown[] = []) => { sqls.push(sql); calls.push(p); return { rows: [], rowCount: 0 }; };
	const store = new AgentBasesStore({ query, connect: async () => ({ query, release: () => {} }) } as never);
	await store.applySlice("ag", [{ key: "Б1", status: "ONLINE" }, { key: " Б1 ", status: "OVER_LIMIT" }, { key: "Б2" }], true);
	const insert = calls[sqls.findIndex((q) => q.includes("INSERT INTO agent_bases"))];
	// Удаление пропавших и запись — в одной транзакции (C17).
	assert.deepEqual(sqls.filter((q) => /^(BEGIN|COMMIT)$/.test(q)), ["BEGIN", "COMMIT"]);
	assert.deepEqual(insert[1], ["Б1", "Б2"]);
	assert.deepEqual(insert[3], ["ONLINE", null]);
});

test("C3: два агента с одной базой — сверх лимита у первого не мешает второму; агент диалога — первым", () => {
	const a1 = { ...slice([base("Альфа", 0, ["111"]), base("Бета", 1, ["222"])], 1, null), agentId: "a1" };
	const a2 = { ...slice([base("Бета", 0, ["222"])], null, null), agentId: "a2" };
	const d = resolveTarget([a1, a2], { baseKey: "Бета" });
	assert.equal(d.kind === "base" && d.agentId, "a2");
	const byBin = resolveTarget([a1, a2], { bin: "222" });
	assert.equal(byBin.kind === "base" && byBin.agentId, "a2");
	// Никто не обслуживает — первый отказ.
	assert.equal(resolveTarget([a1], { baseKey: "Бета" }).kind, "refused");
	// Одна и та же база у двух агентов — предпочтение агенту, с которым шёл диалог.
	const b1 = { ...slice([base("Общая", 0, ["333"])], null, null), agentId: "b1" };
	const b2 = { ...slice([base("Общая", 0, ["333"])], null, null), agentId: "b2" };
	const pref = resolveTarget([b1, b2], { baseKey: "Общая", preferAgentId: "b2" });
	assert.equal(pref.kind === "base" && pref.agentId, "b2");
});

test("activeBins: обслуживаются ровно они, порядок баз не решает; вне списка — «не активирована»", () => {
	const bases = [base("Альфа", 0, ["111", "222"]), base("Бета", 1, ["333"])];
	const v = evaluateLimits(bases, { maxBases: null, maxBins: 1, activeBins: ["333"] });
	assert.deepEqual(v.overBins.sort(), ["111", "222"]);
	const d = resolveTarget([slice(bases, null, 1)].map((s) => ({ ...s, limits: { ...s.limits, activeBins: ["333"] } })), { bin: "111" });
	assert.equal(d.kind, "refused");
	assert.match(d.kind === "refused" ? d.message : "", /не активирована/);
	const ok = resolveTarget([slice(bases, null, 1)].map((s) => ({ ...s, limits: { ...s.limits, activeBins: ["333"] } })), { bin: "333" });
	assert.equal(ok.kind === "base" && ok.baseKey, "Бета");
	// БИН в списке, но его база сверх лимита баз — всё равно не обслуживается.
	const v2 = evaluateLimits(bases, { maxBases: 1, maxBins: null, activeBins: ["333"] });
	assert.deepEqual(v2.overBins.sort(), ["111", "222", "333"]);
	// Панель: пометка active по списку; без списка — null.
	const p = describeAgentBases(bases, { maxBases: null, maxBins: null, activeBins: ["111"] });
	assert.deepEqual(p.bases[0].organizations!.map((o) => o.active), [true, false]);
	assert.equal(describeAgentBases(bases, { maxBases: null, maxBins: null }).bases[0].organizations![0].active, null);
});

test("лимиты агенту: activeBins — только когда список задан", () => {
	assert.deepEqual(limitsForAgent({ maxBases: 2, maxBins: null, activeBins: null }), { maxBases: 2, maxBins: null });
	assert.deepEqual(limitsForAgent({ maxBases: 2, maxBins: 3, activeBins: ["1"] }), { maxBases: 2, maxBins: 3, activeBins: ["1"] });
});

test("C15/C16: расхождение отметки агента с правилом сервиса видно по базе", () => {
	const b = [base("Б1", 0), base("Б2", 1), base("Б3", 2)];
	b[1] = { ...b[1], overLimit: true };   // агент считает Б2 сверх лимита, сервис при maxBases=2 — нет
	b[2] = { ...b[2], overLimit: true };   // здесь согласны
	assert.deepEqual(limitMismatches(b, { maxBases: 2, maxBins: null }), ["Б2"]);
	// Агент отметок не прислал — сравнивать не с чем.
	assert.deepEqual(limitMismatches([base("Б1", 0), base("Б2", 1)], { maxBases: 1, maxBins: null }), []);
});
