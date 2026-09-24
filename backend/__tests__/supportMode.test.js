// Режим поддержки: доступ оператора установки к учётным данным (О5 плана
// PLAN_INSTALL_MODES_2026-09-24.md).
import test from "node:test";
import assert from "node:assert/strict";
import { operatorAccessMode, parseSupportMode, operatorSeesData, MAX_MINUTES } from "../services/supportMode.js";

test("умолчание — прежнее поведение, разделение включается явно", () => {
	// Внезапная потеря сквозного доступа на работающей установке выглядела бы поломкой.
	const saved = process.env.OPERATOR_DATA_ACCESS;
	try {
		delete process.env.OPERATOR_DATA_ACCESS;
		assert.equal(operatorAccessMode(), "always");
		process.env.OPERATOR_DATA_ACCESS = "support-mode";
		assert.equal(operatorAccessMode(), "support-mode");
		process.env.OPERATOR_DATA_ACCESS = "мусор";
		assert.equal(operatorAccessMode(), "always");
	} finally {
		if (saved === undefined) delete process.env.OPERATOR_DATA_ACCESS; else process.env.OPERATOR_DATA_ACCESS = saved;
	}
});

test("истёкший режим поддержки равен выключенному", () => {
	const now = Date.parse("2026-09-24T12:00:00Z");
	const live = JSON.stringify({ until: "2026-09-24T12:30:00Z", by: "admin", reason: "разбор обращения" });
	const dead = JSON.stringify({ until: "2026-09-24T11:30:00Z", by: "admin", reason: "разбор обращения" });
	assert.ok(parseSupportMode(live, now));
	assert.equal(parseSupportMode(dead, now), null, "время вышло — доступ закрыт сам, без чьего-либо участия");
	assert.equal(parseSupportMode(null, now), null);
	assert.equal(parseSupportMode("не json", now), null);
});

test("в режиме support-mode данные закрыты, пока поддержка не включена", () => {
	assert.equal(operatorSeesData({ mode: "support-mode", support: null }), false);
	assert.equal(operatorSeesData({ mode: "support-mode", support: { until: "2026-09-24T12:30:00Z" } }), true);
	// При always — как было: оператор видит всё всегда.
	assert.equal(operatorSeesData({ mode: "always", support: null }), true);
});

test("поддержка не бывает бессрочной", () => {
	// «Навсегда» — это не поддержка, а тихо возвращённый сквозной доступ.
	assert.ok(MAX_MINUTES <= 8 * 60);
});
