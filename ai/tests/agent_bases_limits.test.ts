// Бизнес-агент: лимит баз и выбор базы для команды (СВ3 19.09; модель без владельца 28.09,
// docs/TASK_SERVICE_AGENT_OWNER_MODEL_2026-09-28.md).
//
// Лимит — то же правило, что у агента: первые maxBases баз по порядку среза. Лимит и допуск БИН отменены (Р2).
// Выбор базы — единственное правило (В2): база с БИН организации у ЛЮБОГО бизнес-агента; несколько — явная база или
// агент диалога, затем база, которую организация назвала своей, иначе BASE_AMBIGUOUS.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	AgentBasesStore, baseLimitRefusal, describeAgentBases, evaluateLimits, limitMismatches, limitsForAgent, ownedBasesOf, parseLimit,
	resolveBusinessTarget, type AgentBase, type AgentSlice,
} from "../src/agents/agentBases.ts";

const BIN = "111111111111";
const OTHER = "222222222222";

const base = (key: string, pos: number, bins: string[] = [], transport: "http" | "com" = "com"): AgentBase => ({
	key, pos, status: "ONLINE", transport, extVersion: "1.4.0", overLimit: null, seenAt: null,
	organizations: bins.map((bin, i) => ({ id: `${key}-org${i}`, name: `Орг ${bin}`, bin })),
});
const agent = (agentId: string, bases: AgentBase[], opts: { maxBases?: number | null; online?: boolean } = {}): AgentSlice =>
	({ agentId, online: opts.online ?? true, bases, limits: { maxBases: opts.maxBases ?? null } });
const owned = (...keys: string[]) => ownedBasesOf(keys.map((key) => ({ key, serverId: "srv" })));

// ── Лимит баз ────────────────────────────────────────────────────────────────

test("без лимита — сверх лимита нет ничего; организации считаются по всем базам", () => {
	const v = evaluateLimits([base("A", 0, [BIN]), base("B", 1, [OTHER])], { maxBases: null });
	assert.deepEqual(v.overBases, []);
	assert.deepEqual(v.usage, { bases: 2, bins: 2 });
});

test("3 базы (2 COM, 1 HTTP), maxBases=2 — третья сверх лимита, команда в неё отвергается сервисом", () => {
	const bases = [base("Альфа", 0, [OTHER]), base("Бета", 1, ["333333333333"]), base("Гамма", 2, [BIN], "http")];
	assert.deepEqual(evaluateLimits(bases, { maxBases: 2 }).overBases, ["Гамма"]);
	const d = resolveBusinessTarget([agent("a1", bases, { maxBases: 2 })], { bin: BIN });
	assert.equal(d.kind, "refused");
	assert.match(d.kind === "refused" ? d.message : "", /тариф: 2 базы, подключено 3/);
	// Служебная команда с явной базой — тем же лимитом.
	assert.equal(baseLimitRefusal(agent("a1", bases, { maxBases: 2 }), "гамма")?.code, "LICENSE_LIMIT");
	assert.equal(baseLimitRefusal(agent("a1", bases, { maxBases: 2 }), "Альфа"), null);
});

test("лимиты агенту: maxBins всегда null (без ограничения), activeBins не шлётся — допуск БИН отменён", () => {
	assert.deepEqual(limitsForAgent({ maxBases: 2 }), { maxBases: 2, maxBins: null });
	assert.deepEqual(limitsForAgent({ maxBases: null }), { maxBases: null, maxBins: null });
});

test("панель: 3 базы при maxBases=2 — третья «сверх лимита», счётчики по подключённым, БИН в двух базах показан", () => {
	const v = describeAgentBases([base("Б1", 0, [BIN]), base("Б2", 1, [OTHER]), base("Б3", 2, [BIN], "http")], { maxBases: 2 });
	assert.deepEqual(v.usage, { bases: 3, bins: 2 });
	assert.deepEqual(v.bases.map((b) => [b.key, b.transport, b.overLimitService]), [["Б1", "com", false], ["Б2", "com", false], ["Б3", "http", true]]);
	assert.deepEqual([v.bases[2].organizations![0].overLimit, v.bases[2].organizations![0].alsoIn], [true, ["Б1"]]);
	assert.deepEqual(v.bases[0].organizations![0].alsoIn, ["Б3"]);
});

test("лимит из панели: целое ≥ 0 или пусто; остальное — отказ", () => {
	assert.equal(parseLimit(""), null);
	assert.equal(parseLimit(null), null);
	assert.equal(parseLimit(5), 5);
	assert.equal(parseLimit(" 7 "), 7);
	assert.equal(parseLimit(0), 0);
	for (const bad of [-1, 1.5, "abc", "1e3", true, {}]) assert.equal(parseLimit(bad), undefined, String(bad));
});

test("C15/C16: расхождение отметки агента с правилом сервиса видно по базе", () => {
	const b = [base("Б1", 0), base("Б2", 1), base("Б3", 2)];
	b[1] = { ...b[1], overLimit: true };   // агент считает Б2 сверх лимита, сервис при maxBases=2 — нет
	b[2] = { ...b[2], overLimit: true };   // здесь согласны
	assert.deepEqual(limitMismatches(b, { maxBases: 2 }), ["Б2"]);
	// Агент отметок не прислал — сравнивать не с чем.
	assert.deepEqual(limitMismatches([base("Б1", 0), base("Б2", 1)], { maxBases: 1 }), []);
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

// ── Выбор базы (В2, В9) ─────────────────────────────────────────────────────

test("свой агент, агент фирмы, агент BuhProf — одно правило: база с БИН организации у любого агента", () => {
	// Кем бы агент ни был заведён, у него нет организации: решает только срез.
	for (const who of ["свой", "фирмы", "BuhProf"]) {
		const d = resolveBusinessTarget([agent(`ag-${who}`, [base("Dev_01", 0, [OTHER]), base("shahs", 1, [BIN])])], { bin: BIN });
		assert.equal(d.kind === "base" && d.baseKey, "shahs", who);
	}
	// Базы с этим БИН нет ни у кого — `none`, а не «первая база».
	assert.equal(resolveBusinessTarget([agent("a1", [base("Dev_01", 0, [OTHER])])], { bin: BIN }).kind, "none");
	// БИН не известен — выбирать нечем.
	assert.equal(resolveBusinessTarget([agent("a1", [base("Dev_01", 0, [BIN])])], { bin: null }).kind, "none");
});

test("агент старой сборки организаций не сообщает — его базы кандидатами не бывают", () => {
	const old = agent("old", [{ ...base("shahs", 0), organizations: null }]);
	assert.equal(resolveBusinessTarget([old], { bin: BIN }).kind, "none");
	assert.equal(resolveBusinessTarget([old], { bin: BIN, baseKey: "shahs" }).kind, "none", "явная база без БИН в ней — тоже нет");
});

test("явная база — только если в ней есть организация с этим БИН: чужая база по имени не достаётся", () => {
	const a = agent("a1", [base("Своя", 0, [BIN]), base("Чужая", 1, [OTHER])]);
	assert.equal(resolveBusinessTarget([a], { bin: BIN, baseKey: "чужая" }).kind, "none");
	const d = resolveBusinessTarget([a], { bin: BIN, baseKey: "своя" });
	assert.equal(d.kind === "base" && d.baseKey, "Своя");
});

test("БИН в двух базах: своя база (одобренная заявка или токен чата) — туда; без своей — BASE_AMBIGUOUS", () => {
	const slices = [agent("firm", [base("shahs", 0, [BIN])]), agent("old-firm", [base("shahs_copy", 0, [BIN])])];
	const none = resolveBusinessTarget(slices, { bin: BIN });
	assert.equal(none.kind, "ambiguous");
	assert.deepEqual(none.kind === "ambiguous" ? none.hits.map((h) => h.baseKey).sort() : [], ["shahs", "shahs_copy"]);
	const d = resolveBusinessTarget(slices, { bin: BIN }, owned("shahs"));
	assert.equal(d.kind === "base" && d.agentId, "firm");
	assert.deepEqual(d.kind === "base" ? d.alsoIn : [], ["shahs_copy"]);
});

test("агент на связи не поднимает базу уровнем ниже: своя лежит, копия на связи — команда всё равно в свою", () => {
	const slices = [agent("firm", [base("shahs", 0, [BIN])], { online: false }), agent("copy", [base("shahs_copy", 0, [BIN])])];
	const d = resolveBusinessTarget(slices, { bin: BIN }, owned("shahs"));
	assert.equal(d.kind === "base" && d.agentId, "firm", "не на связи — это AGENT_OFFLINE у вызывающего, а не повод уйти в копию");
});

test("внутри одного уровня — агент на связи: одноимённая своя база у двух агентов", () => {
	const slices = [agent("a1", [base("shahs", 0, [BIN])], { online: false }), agent("a2", [base("shahs", 0, [BIN])])];
	const d = resolveBusinessTarget(slices, { bin: BIN }, owned("shahs"));
	assert.equal(d.kind === "base" && d.agentId, "a2");
	// Обе на связи — не выбрать.
	const both = [agent("a1", [base("shahs", 0, [BIN])]), agent("a2", [base("shahs", 0, [BIN])])];
	assert.equal(resolveBusinessTarget(both, { bin: BIN }, owned("shahs")).kind, "ambiguous");
});

test("своя база под одним ключом на двух серверах — ключ неоднозначен, в правило не идёт", () => {
	const two = ownedBasesOf([{ key: "shahs", serverId: "srv-1" }, { key: "SHAHS", serverId: "srv-2" }]);
	assert.ok(two.ambiguousKeys.has("shahs"));
	const slices = [agent("a1", [base("shahs", 0, [BIN])]), agent("a2", [base("other", 0, [BIN])])];
	assert.equal(resolveBusinessTarget(slices, { bin: BIN }, two).kind, "ambiguous");
});

test("агент диалога — первым среди своих баз; одна база у агента диалога — туда", () => {
	const slices = [agent("b1", [base("Общая", 0, [BIN])]), agent("b2", [base("Общая", 0, [BIN])])];
	const d = resolveBusinessTarget(slices, { bin: BIN, baseKey: "Общая", preferAgentId: "b2" });
	assert.equal(d.kind === "base" && d.agentId, "b2");
});

test("сверх maxBases у одного агента не мешает другому с той же организацией", () => {
	const a1 = agent("a1", [base("Альфа", 0, [OTHER]), base("Бета", 1, [BIN])], { maxBases: 1 });
	const a2 = agent("a2", [base("Бета", 0, [BIN])]);
	const d = resolveBusinessTarget([a1, a2], { bin: BIN });
	assert.equal(d.kind === "base" && d.agentId, "a2");
	assert.equal(resolveBusinessTarget([a1], { bin: BIN }).kind, "refused", "никто другой — отказ по лимиту");
});
