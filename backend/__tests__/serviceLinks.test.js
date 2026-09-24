// Обслуживание клиентов консалтинговой фирмой (К1–К5 плана PLAN_INSTALL_MODES_2026-09-24.md).
//
// Проверяются ПРАВИЛА, не хранилище: живут они в чистых функциях именно ради этого.
import test from "node:test";
import assert from "node:assert/strict";
import { linkIsLive, allowedModules, LINK_STATES, STAFF_ROLES } from "../services/serviceLinks.js";

const now = new Date("2026-09-24T12:00:00Z");

test("доступ даёт только подтверждённая связь", () => {
	// Связь рождается в `requested`: завести себе доступ к чужому учёту, зная uuid, нельзя —
	// впускает фирму только клиент.
	assert.equal(linkIsLive({ state: "requested" }, now), false);
	assert.equal(linkIsLive({ state: "active" }, now), true);
	assert.equal(linkIsLive({ state: "suspended" }, now), false);
	assert.equal(linkIsLive({ state: "revoked" }, now), false);
	assert.equal(linkIsLive(null, now), false);
});

test("срок договора прекращает доступ сам", () => {
	// «Когда вспомнят» — это никогда: договор заканчивается, а доступ остаётся годами.
	assert.equal(linkIsLive({ state: "active", validUntil: "2026-12-31T00:00:00Z" }, now), true);
	assert.equal(linkIsLive({ state: "active", validUntil: "2026-09-01T00:00:00Z" }, now), false);
	assert.equal(linkIsLive({ state: "active", validUntil: null }, now), true, "бессрочный договор — тоже договор");
});

test("модули: пусто значит «все установленные у клиента»", () => {
	// Перечислять их по одному значило бы поддерживать список вручную при каждом изменении
	// состава у клиента — и однажды забыть.
	assert.equal(allowedModules({ modules: null }), null);
	assert.equal(allowedModules({ modules: "  " }), null);
	assert.deepEqual(allowedModules({ modules: "sales, cash" }), ["sales", "cash"]);
	assert.deepEqual(allowedModules({ modules: "sales,,cash," }), ["sales", "cash"]);
});

test("состояния и роли заданы явно", () => {
	assert.deepEqual(LINK_STATES, ["requested", "active", "suspended", "revoked"]);
	assert.deepEqual(STAFF_ROLES, ["lead", "assistant"]);
});
