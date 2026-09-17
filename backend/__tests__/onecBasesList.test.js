// ─────────────────────────────────────────────────────────────────────────────
// Список баз 1С: состав и сортировка по колонке «Статус».
//
// ЖИВОЙ СЛУЧАЙ (17.09). Щелчок по «Статусу» не менял порядок: сортировали по коду
// кластера, а он у всех баз ONLINE — «нет в СУБД» показывает панель по отметке
// недоступности. Сортируется показанное состояние.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStateRank, isListedBase, parseSort, sortBases } from "../utils/onecBasesList.js";

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
