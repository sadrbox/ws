// Н6 и раздел 5 аудита 26.09 — чистые части: охват фирмы, отбор «уже сделанного», приём находок
// без построчных UPDATE, имена владельцев пачкой, раскладка панели главбуха. HEADLESS (без БД).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFirmScope, todoScopeWhere } from "../services/quality/scope.js";
import { manyKeys, freshRecipients } from "../services/quality/dedupBatch.js";
import { canonicalJson, findingChanged, splitSeenUpdates } from "../services/quality/ingestPlan.js";
import { groupByOrg, primaryDocsState } from "../services/quality/dashboards.js";
import { deadlineDueAt } from "../services/quality/taskRules.js";
import { computeBonusResults } from "../services/quality/bonusRules.js";
import { enrichWithOwnerName } from "../utils/resolveOwnerName.js";

test("охват фирмы: фирма, клиенты групп, живые связи; чужие арендаторы — нет", () => {
	const now = new Date("2026-09-26T00:00:00Z");
	const groups = [
		{ headUuid: "chief", managerUuid: "boss", members: [{ userUuid: "acc" }], clients: [{ clientOrganizationUuid: "client-1" }] },
	];
	const links = [
		{ clientOrgUuid: "client-2", state: "active", validUntil: null },
		{ clientOrgUuid: "client-3", state: "requested", validUntil: null }, // не подтверждена
		{ clientOrgUuid: "client-4", state: "active", validUntil: new Date("2026-01-01") }, // срок вышел
	];
	const scope = buildFirmScope("firm", groups, links, now);
	assert.deepEqual(scope.orgUuids.sort(), ["client-1", "client-2", "firm"]);
	assert.deepEqual(scope.staffUuids.sort(), ["acc", "boss", "chief"]);
	const where = todoScopeWhere(scope);
	assert.deepEqual(where.OR[0], { organizationUuid: { in: scope.orgUuids } });
	assert.deepEqual(where.OR[1], { organizationUuid: null, executorUuid: { in: scope.staffUuids } }, "задача без организации — только у сотрудника фирмы");
	assert.deepEqual(todoScopeWhere(buildFirmScope("firm", [], [], now)).OR.length, 1);
});

test("уведомления: ключи notifyMany и отбор тех, кому ещё не уходило", () => {
	assert.deepEqual(manyKeys(["a", "b", "a", null], "overdue-chief:t1"), ["overdue-chief:t1:a", "overdue-chief:t1:b"]);
	const sent = new Set(["overdue-chief:t1:a"]);
	assert.deepEqual(freshRecipients(["a", "b", "b"], "overdue-chief:t1", sent), ["b"]);
	assert.deepEqual(freshRecipients([], "x", sent), []);
});

test("приём находок: неизменённые — одним updateMany, изменившиеся и вернувшиеся — целиком", () => {
	const stored = {
		u1: { severity: "error", title: "Минус: Бумага", factDate: new Date("2026-09-20"), amount: "-12000.00", data: { documents: [], objects: [{ b: 2, a: 1 }], account: "1330", quantity: null, details: {} } },
		u2: { severity: "error", title: "Минус: Скрепки", factDate: null, amount: null, data: { account: null } },
		u3: { severity: "warning", title: "Старое", factDate: null, amount: null, data: {} },
	};
	const same = { severity: "error", title: "Минус: Бумага", factDate: new Date("2026-09-20"), amount: -12000, data: { account: "1330", quantity: null, objects: [{ a: 1, b: 2 }], documents: [], details: {} } };
	assert.equal(findingChanged(stored.u1, same), false, "порядок ключей jsonb и Decimal-строка — не изменение");
	assert.equal(findingChanged(stored.u1, { ...same, amount: -12000.004 }), false, "копейки округляются как в колонке");
	assert.equal(findingChanged(stored.u1, { ...same, amount: -11000 }), true);
	assert.equal(findingChanged(stored.u1, { ...same, factDate: null }), true);
	assert.equal(findingChanged(stored.u1, { ...same, data: { ...same.data, objects: [{ a: 1, b: 3 }] } }), true);
	const { touch, full } = splitSeenUpdates([
		{ uuid: "u1", value: same, reopened: false },
		{ uuid: "u2", value: { severity: "error", title: "Минус: Скрепки", factDate: null, amount: null, data: { account: null } }, reopened: true },
		{ uuid: "u3", value: { severity: "error", title: "Новое", factDate: null, amount: null, data: {} }, reopened: false },
	], new Map(Object.entries(stored)));
	assert.deepEqual(touch, ["u1"]);
	assert.deepEqual(full.map((u) => u.uuid), ["u2", "u3"], "вернувшаяся — всегда целиком (снимается resolvedAt)");
	assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
});

test("панель главбуха: строки раскладываются по клиентам за один проход", () => {
	const m = groupByOrg([{ organizationUuid: "a", n: 1 }, { organizationUuid: "b", n: 2 }, { organizationUuid: "a", n: 3 }]);
	assert.deepEqual(m.get("a").map((r) => r.n), [1, 3]);
	assert.deepEqual(m.get("b").map((r) => r.n), [2]);
	assert.equal(m.get("c"), undefined);
});

test("имена владельцев: один запрос на тип владельца, а не на строку", async () => {
	const calls = [];
	const model = (field, rows) => ({
		findMany: async (args) => {
			calls.push(args);
			return rows.filter((r) => args.where.uuid.in.includes(r.uuid)).map((r) => ({ uuid: r.uuid, [field]: r[field] }));
		},
	});
	const db = {
		counterparty: model("name", [{ uuid: "c1", name: "ТОО Рога" }, { uuid: "c2", name: "ИП Копыта" }]),
		employee: model("fullName", [{ uuid: "e1", fullName: "Иванова А." }]),
		organization: model("name", []),
		contactPerson: { findMany: async () => { throw new Error("нет таблицы"); } },
	};
	const items = [];
	for (let i = 0; i < 500; i++) items.push({ id: i, ownerType: i % 2 ? "counterparty" : "employee", ownerUuid: i % 2 ? (i % 4 === 1 ? "c1" : "c2") : "e1" });
	items.push({ id: 900, ownerType: "contactperson", ownerUuid: "p1" }, { id: 901, ownerType: "unknown", ownerUuid: "x" }, { id: 902 });
	const out = await enrichWithOwnerName(items, db);
	assert.equal(calls.length, 2, "500 строк — два запроса (по типу), а не 500");
	assert.deepEqual(calls.find((c) => c.select.name).where.uuid.in.sort(), ["c1", "c2"]);
	assert.equal(out[1].ownerName, "ТОО Рога");
	assert.equal(out[3].ownerName, "ИП Копыта");
	assert.equal(out[0].ownerName, "Иванова А.");
	assert.equal(out.find((x) => x.id === 900).ownerName, "", "ошибка типа — пустое имя, а не падение списка");
	assert.equal(out.find((x) => x.id === 902).ownerName, "");
	assert.deepEqual(await enrichWithOwnerName([], db), []);
});

// ── Три точечных пункта от исполнителя «frontend-экраны качества» (26.09) ────────────────────────

test("панель главбуха: первичка за месяц — по всем поступлениям, а не по первому попавшемуся", () => {
	const partial = { organizationUuid: "a", complete: false, receivedAt: new Date("2026-09-05T08:00:00Z") };
	const full = { organizationUuid: "a", complete: true, receivedAt: new Date("2026-09-08T08:00:00Z") };
	assert.deepEqual(primaryDocsState([partial, full]), { received: true, complete: true, receivedAt: full.receivedAt });
	assert.deepEqual(primaryDocsState([full, partial]), { received: true, complete: true, receivedAt: full.receivedAt }, "порядок строк из базы не важен");
	assert.deepEqual(primaryDocsState([partial]), { received: true, complete: false, receivedAt: partial.receivedAt });
	assert.deepEqual(primaryDocsState([]), { received: false });
	assert.deepEqual(primaryDocsState(undefined), { received: false });
});

test("бонус: мера в день нарушения снимает «мер нет» — сравниваются местные даты, а не моменты", () => {
	const s = { violations: { systematicMonths: 3, systematicThreshold: 1 } };
	const v = (over) => ({ uuid: Math.random().toString(36), userUuid: "A", itemNumber: 20, description: "x", status: "confirmed", bonusMonth: "2026-09", ...over });
	// Нарушение выявлено 02.09 в 14:00 по Алматы (09:00Z).
	const violations = [v({ detectedAt: new Date("2026-09-02T09:00:00Z") })];
	const run = (date) => computeBonusResults({ month: "2026-09", staff: [], violations, measures: [{ userUuid: "A", date }], settings: s, tz: "Asia/Almaty" })[0];
	assert.equal(run(new Date("2026-09-02T00:00:00Z")).noMeasure, false, "старая мера — голая дата 02.09 (00:00Z, то есть 05:00 местных) — тот же день");
	assert.equal(run(new Date("2026-09-02T18:59:59.999Z")).noMeasure, false, "новая мера — конец местного дня 02.09");
	assert.equal(run(new Date("2026-09-01T19:00:00Z")).noMeasure, false, "00:00 по Алматы 02.09 — уже 02.09, хотя по UTC ещё 01.09");
	assert.equal(run(new Date("2026-09-01T18:59:59.999Z")).noMeasure, true, "мера накануне — реакции на нарушение не было");
	assert.equal(run("2026-09-02").noMeasure, false, "дата строкой — буквально");
	assert.equal(computeBonusResults({ month: "2026-09", staff: [], violations, measures: [], settings: s, tz: "Asia/Almaty" })[0].noMeasure, true);
});

test("срок задачи голой датой (00:00Z) истекает в конце местного дня, точные сроки — как есть", () => {
	const tz = "Asia/Almaty";
	const bare = new Date("2026-09-26T00:00:00.000Z");
	assert.equal(deadlineDueAt(bare, tz).toISOString(), "2026-09-26T18:59:59.999Z");
	assert.equal(deadlineDueAt("2026-09-26T00:00:00.000Z", tz).toISOString(), "2026-09-26T18:59:59.999Z", "строка ISO — так же");
	const exact = new Date("2026-09-26T13:00:00.000Z");
	assert.equal(deadlineDueAt(exact, tz).getTime(), exact.getTime(), "срок по SLA (18:00 местных) не трогаем");
	const localEnd = new Date("2026-09-26T18:59:59.999Z");
	assert.equal(deadlineDueAt(localEnd, tz).getTime(), localEnd.getTime(), "срок, записанный новым фронтом, не трогаем");
	assert.equal(deadlineDueAt(null, tz), null);
	assert.equal(deadlineDueAt("вчера", tz), null);
	// Просрочка: в 10:00 по Алматы 26.09 задача со сроком «26.09» ещё не просрочена, после полуночи — да.
	const morning = new Date("2026-09-26T05:00:00Z");
	const night = new Date("2026-09-26T19:00:00Z");
	assert.equal(deadlineDueAt(bare, tz) < morning, false);
	assert.equal(deadlineDueAt(bare, tz) < night, true);
});
