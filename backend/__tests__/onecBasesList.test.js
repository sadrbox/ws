// ─────────────────────────────────────────────────────────────────────────────
// Список баз 1С: состав и сортировка по колонке «Статус».
//
// ЖИВОЙ СЛУЧАЙ (17.09). Щелчок по «Статусу» не менял порядок: сортировали по коду
// кластера, а он у всех баз ONLINE — «нет в СУБД» показывает панель по отметке
// недоступности. Сортируется показанное состояние.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASE_STATE_LABELS, PUBLISH_LABELS, baseStateRank, isListedBase, matchesBaseSearch, parseSort, sortBases, stableRowId, withStableIds } from "../utils/onecBasesList.js";

const b = (baseKey, over = {}) => ({ baseKey, status: "ONLINE", ibUnreachableAt: null, ibUnreachableReason: null, ...over });
const keys = (xs) => xs.map((x) => x.baseKey);

// Как в живом реестре: код у всех ONLINE, часть баз — фантомы.
const rows = [
	b("a_ok"),
	b("b_nodb", { ibUnreachableAt: "2026-09-17T08:00:00Z", ibUnreachableReason: "NO_DB" }),
	b("c_ok"),
	b("d_noaccess", { ibUnreachableAt: "2026-09-17T08:00:00Z", ibUnreachableReason: "NO_ACCESS" }),
	b("e_missing", { status: "MISSING" }),
	b("f_unknown", { status: "UNKNOWN" }),
];

test("«Статус» по возрастанию: рабочие базы первыми, проблемные — следом", () => {
	assert.deepEqual(keys(sortBases(rows, { status: "asc" })), ["a_ok", "c_ok", "d_noaccess", "b_nodb", "e_missing", "f_unknown"]);
});

test("«Статус» по убыванию — обратный порядок состояний, равные в порядке сервиса", () => {
	assert.deepEqual(keys(sortBases(rows, { status: "desc" })), ["f_unknown", "e_missing", "b_nodb", "d_noaccess", "a_ok", "c_ok"]);
});

test("порядок asc и desc различается даже когда код кластера у всех одинаковый", () => {
	const same = [b("x1"), b("x2", { ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" }), b("x3")];
	assert.notDeepEqual(keys(sortBases(same, { status: "asc" })), keys(sortBases(same, { status: "desc" })));
});

test("ранг следует подписи: «нет в кластере» важнее недоступности, недоступность — важнее ONLINE", () => {
	assert.equal(baseStateRank(b("m", { status: "MISSING", ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" })), 4);
	assert.equal(baseStateRank(b("o", { ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" })), 3);
	assert.equal(baseStateRank(b("u", { ibUnreachableAt: "t", ibUnreachableReason: "WHATEVER" })), 2);
});

test("прочие колонки сортируются как прежде", () => {
	assert.deepEqual(keys(sortBases(rows, { baseKey: "desc" })), ["f_unknown", "e_missing", "d_noaccess", "c_ok", "b_nodb", "a_ok"]);
	assert.equal(sortBases(rows, null), rows);
	assert.deepEqual(parseSort('{"status":"asc"}'), { status: "asc" });
	assert.equal(parseSort("не json"), null);
});

// ЖИВОЙ СЛУЧАЙ (17.09): nomadstroygroup скрыли и удалили её регистрацию из кластера. Сервис отдаёт скрытой базе
// status = DISABLED, и по одному status «нет в кластере» было не отличить от «скрыта».
test("по умолчанию в списке нет удалённых из кластера — и скрытых тоже", () => {
	assert.equal(isListedBase(b("gone", { status: "MISSING" })), false);
	assert.equal(isListedBase(b("nomadstroygroup", { status: "DISABLED", clusterStatus: "MISSING", disabled: true })), false);
	assert.equal(isListedBase(b("hidden", { status: "DISABLED", clusterStatus: "ONLINE", disabled: true })), false);
});

test("по умолчанию рабочие и недоступные базы в списке", () => {
	for (const x of [
		b("ok"),
		b("nodb", { ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" }),
		b("unknown", { status: "UNKNOWN" }),
	]) assert.equal(isListedBase(x), true, x.baseKey);
});

test("переключатель «скрытые и удалённые из кластера» показывает всех", () => {
	const opt = { showHidden: true };
	assert.equal(isListedBase(b("gone", { status: "MISSING" }), opt), true);
	assert.equal(isListedBase(b("hidden", { status: "DISABLED", disabled: true }), opt), true);
});

test("«Статус»: удалённая из кластера скрытая база сортируется как «нет в кластере», а не как «скрыта»", () => {
	const hiddenGone = b("nomadstroygroup", { status: "DISABLED", clusterStatus: "MISSING", disabled: true, ibUnreachableAt: "t", ibUnreachableReason: "NO_INFOBASE" });
	assert.equal(baseStateRank(hiddenGone), baseStateRank(b("gone", { status: "MISSING" })));
	assert.notEqual(baseStateRank(hiddenGone), baseStateRank(b("hidden", { status: "DISABLED", disabled: true })));
});

test("«Статус»: скрытая недоступная база сортируется как «скрыта» — как её и подписывает панель", () => {
	const hiddenNoDb = b("h", { status: "DISABLED", disabled: true, ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" });
	assert.equal(baseStateRank(hiddenNoDb), baseStateRank(b("hidden", { status: "DISABLED", disabled: true })));
});

// ЖИВОЙ СЛУЧАЙ (17.09): быстрый поиск не находил базы ни по «Статусу», ни по «Адресу публикации» — искал по коду
// кластера (ONLINE), а адрес в поиск не входил вовсе.
test("поиск по «Статусу» — по показанной подписи на RU и KK, регистр не важен", () => {
	const nodb = b("nodb", { ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" });
	assert.equal(matchesBaseSearch(nodb, "нет в субд"), true);
	assert.equal(matchesBaseSearch(nodb, "ДҚБЖ"), true);
	assert.equal(matchesBaseSearch(b("ok"), "доступна"), true);
	assert.equal(matchesBaseSearch(b("ok"), "нет в субд"), false);
	assert.equal(matchesBaseSearch(b("hidden", { status: "DISABLED", disabled: true }), "скрыта"), true);
	const results = [b("a_ok"), nodb, b("gone", { status: "MISSING" })].filter((x) => matchesBaseSearch(x, "недоступ"));
	assert.deepEqual(keys(results), []);
	assert.deepEqual(keys([b("a_ok"), nodb, b("u", { ibUnreachableAt: "t" })].filter((x) => matchesBaseSearch(x, "недоступна"))), ["u"]);
});

test("поиск по «Адресу публикации» — и по публичному адресу, и по адресу от агента", () => {
	const pub = b("pub", { publishUrl: "http://localhost/trade", publishUrlPublic: "https://1c.example.kz/trade" });
	assert.equal(matchesBaseSearch(pub, "1c.example"), true);
	assert.equal(matchesBaseSearch(pub, "localhost/trade"), true);
	assert.equal(matchesBaseSearch(b("nopub"), "localhost"), false);
});

test("пустой поиск пропускает всех; прежние поля ищутся как раньше", () => {
	assert.equal(matchesBaseSearch(b("x"), ""), true);
	assert.equal(matchesBaseSearch(b("x"), "   "), true);
	assert.equal(matchesBaseSearch(b("buh_main", { name: "Бухгалтерия", serverName: "srv1", onecVersion: "8.3.24" }), "SRV1"), true);
	assert.equal(matchesBaseSearch(b("buh_main"), "online"), true);
});

test("подписи состояний совпадают с переводами панели", () => {
	const ru = JSON.parse(readFileSync(new URL("../../frontend/src/i18/translations.json", import.meta.url), "utf8"));
	const kk = JSON.parse(readFileSync(new URL("../../frontend/src/i18/translations.kk.json", import.meta.url), "utf8"));
	const keysByRank = ["onecBaseOnline", "onecBaseNoAccessShort", "onecBaseUnreachableShort", "onecBaseNoDbShort", "onecBaseMissing", "onecBaseDisabled", "onecBaseUnknown"];
	keysByRank.forEach((k, rank) => assert.deepEqual(BASE_STATE_LABELS[rank], [ru[k], kk[k]], k));
	const publishKeys = { true: "onecPublished", false: "onecNotPublished", null: "onecPublishUnknown" };
	for (const [v, k] of Object.entries(publishKeys)) assert.deepEqual(PUBLISH_LABELS[v], [ru[k], kk[k]], k);
});

test("поиск по нескольким словам: каждое должно найтись, порядок не важен", () => {
	const nodb = b("trade_main", { ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" });
	assert.equal(matchesBaseSearch(nodb, "субд trade"), true);
	assert.equal(matchesBaseSearch(nodb, "субд склад"), false);
});

test("поиск по «Публикации» — по подписи, а не по true/false", () => {
	assert.equal(matchesBaseSearch(b("p", { published: true }), "опубликована"), true);
	assert.equal(matchesBaseSearch(b("n", { published: false }), "нет публикации"), true);
	assert.equal(matchesBaseSearch(b("p", { published: true }), "true"), false);
});

test("«Регламентные задания» сортируются по показанному: включено → отключено → не знаем", () => {
	const rows = [
		b("unknown"),
		b("off", { scheduledJobsDenied: true }),
		b("on", { scheduledJobsDenied: false }),
	];
	assert.deepEqual(keys(sortBases(rows, { scheduledJobsDenied: "asc" })), ["on", "off", "unknown"]);
	assert.deepEqual(keys(sortBases(rows, { scheduledJobsDenied: "desc" })), ["unknown", "off", "on"]);
});

// Номер строки — из идентификатора базы (18.09): исчезла одна база — у остальных номера прежние, и отметки
// в таблице не переезжают на соседей.
test("номера строк не зависят от порядка и от числа баз в ответе", () => {
	const key = (x) => x.uuid;
	const before = withStableIds([{ uuid: "u1" }, { uuid: "u2" }, { uuid: "u3" }], key);
	const after = withStableIds([{ uuid: "u2" }, { uuid: "u3" }], key);
	for (const u of ["u2", "u3"]) {
		assert.equal(after.find((x) => x.uuid === u).id, before.find((x) => x.uuid === u).id);
	}
	assert.equal(stableRowId("u1"), stableRowId("u1"));
	assert.notEqual(stableRowId("u1"), stableRowId("u2"));
});

test("номера уникальны даже при пустых ключах", () => {
	const list = withStableIds([{ uuid: "" }, { uuid: "" }, { uuid: "x" }], (x) => x.uuid);
	assert.equal(new Set(list.map((x) => x.id)).size, 3);
	assert.ok(list.every((x) => Number.isSafeInteger(x.id) && x.id > 0));
});
