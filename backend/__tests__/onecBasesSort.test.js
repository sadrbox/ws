// ─────────────────────────────────────────────────────────────────────────────
// Список баз 1С: сортировка по колонке «Статус».
//
// ЖИВОЙ СЛУЧАЙ (17.09). Щелчок по «Статусу» не менял порядок: сортировали по коду
// кластера, а он у всех баз ONLINE — «нет в СУБД» показывает панель по отметке
// недоступности. Сортируется показанное состояние.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStateRank, parseSort, sortBases } from "../utils/onecBasesSort.js";

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

test("ранг следует подписи: недоступность важнее кода кластера", () => {
	assert.equal(baseStateRank(b("m", { status: "MISSING", ibUnreachableAt: "t", ibUnreachableReason: "NO_DB" })), 3);
	assert.equal(baseStateRank(b("u", { ibUnreachableAt: "t", ibUnreachableReason: "WHATEVER" })), 2);
});

test("прочие колонки сортируются как прежде", () => {
	assert.deepEqual(keys(sortBases(rows, { baseKey: "desc" })), ["f_unknown", "e_missing", "d_noaccess", "c_ok", "b_nodb", "a_ok"]);
	assert.equal(sortBases(rows, null), rows);
	assert.deepEqual(parseSort('{"status":"asc"}'), { status: "asc" });
	assert.equal(parseSort("не json"), null);
});
