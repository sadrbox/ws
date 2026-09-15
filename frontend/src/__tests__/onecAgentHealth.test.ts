/**
 * Состояние сервера 1С словами (R1) и сборка агента (R3): таблица показывает только пришедшее,
 * а требующее внимания отмечает.
 */
import { describe, expect, it } from "vitest";
import { translate } from "src/i18";
import { agentBuildLabel, featureLabels, healthSections } from "src/models/OneCAdmin/agentHealth";

describe("healthSections", () => {
	it("разделы по ответу; неготовое, база без СУБД и ошибка кластеров — с отметкой", () => {
		const s = healthSections({
			agent: { build: "2026-09-14 23:16 (+05)", state: "ONLINE", maxParallel: 4, persistentBridge: false, ibReady: true },
			readiness: { items: [{ key: "rac", ok: true }, { key: "dbPassword", ok: false, note: "не задан" }] },
			cluster: {
				platform: "8.3.25.1257",
				clusters: { error: "RAS не отвечает" },
				bases: { known: 110, dbChecked: 110, dbMissing: ["aibek"] },
				dbPassword: true,
				dbmsClients: [{ name: "psql", path: null }],
			},
			commands: { done: 5, failed: 1 },
		});
		expect(s).toHaveLength(4);
		expect(s.every((x) => x.rows.length > 0)).toBe(true);
		expect(s[1].rows.find((r) => r.label === "dbPassword")?.warn).toBe(true);
		expect(s[1].rows.find((r) => r.label === "rac")?.warn).toBeUndefined();
		const cluster = s[2].rows;
		expect(cluster.some((r) => r.warn && r.value.includes("aibek"))).toBe(true);
		expect(cluster.some((r) => r.warn && r.value.includes("RAS не отвечает"))).toBe(true);
		expect(s[3].rows[0].warn).toBe(true);
	});

	it("чтение блокировок (П11): отставание и пауза — с отметкой, последний отказ — отдельной строкой", () => {
		const s = healthSections({
			cluster: { locks: { known: 111, fresh: 90, enabled: 3, paused: 2, lastRefusal: { base: "aibek", reason: "нет входа" } } },
		});
		const rows = s[0].rows;
		expect(rows[0].value).toContain("90 / 111");
		expect(rows[0].warn).toBe(true);
		expect(rows[1]).toMatchObject({ warn: true });
		expect(rows[1].value).toContain("aibek — нет входа");
		const calm = healthSections({ cluster: { locks: { known: 5, fresh: 5, enabled: 0, paused: 0, lastRefusal: null } } });
		expect(calm[0].rows).toHaveLength(1);
		expect(calm[0].rows[0].warn).toBeUndefined();
	});

	it("отказ сервиса принять heartbeat и неподтверждённый вход — с отметкой (С32)", () => {
		const s = healthSections({ agent: { ibConfirmed: false, heartbeatRejected: { message: "400: processes[3].what > 200" } } });
		const rows = s[0].rows;
		expect(rows.find((r) => r.label === translate("onecHealthIbConfirmed"))?.warn).toBe(true);
		const rej = rows.find((r) => r.label === translate("onecHealthHeartbeatRejected"));
		expect(rej?.warn).toBe(true);
		expect(rej?.value).toContain("processes[3].what");
	});

	it("С24: предел агента не меньше срока сервиса или выключен — предупреждение", () => {
		const ttl = { commandTtlSecs: 900, longCommandTtlSecs: 15000 };
		const label = translate("onecHealthLimitOverTtl");
		const warn = (a: { commandTimeoutSecs: number; longCommandTimeoutSecs: number }) =>
			healthSections({ agent: a }, ttl)[0]?.rows.find((r) => r.label === label);
		expect(warn({ commandTimeoutSecs: 600, longCommandTimeoutSecs: 14400 })).toBeUndefined();
		expect(warn({ commandTimeoutSecs: 600, longCommandTimeoutSecs: 20000 })?.warn).toBe(true);
		expect(warn({ commandTimeoutSecs: 0, longCommandTimeoutSecs: 14400 })?.value).toContain(translate("onecHealthNoLimit"));
		// Сроки сервиса не пришли (сервис старее панели) — сравнивать не с чем.
		expect(healthSections({ agent: { commandTimeoutSecs: 0, longCommandTimeoutSecs: 0 } })[0].rows.some((r) => r.label === label)).toBe(false);
	});

	it("бизнес-агент без кластера и пустые поля — разделов и строк нет", () => {
		const s = healthSections({ agent: { state: "ONLINE", lastError: null }, cluster: null, readiness: { items: [] } });
		expect(s).toHaveLength(1);
		expect(s[0].rows).toHaveLength(1);
	});
});

describe("сборка агента", () => {
	it("устаревшая — с отметкой, неизвестная — прочерк", () => {
		expect(agentBuildLabel({ build: "2026-09-14 01:35", buildOutdated: true })).toContain("2026-09-14 01:35 · ");
		expect(agentBuildLabel({ build: "2026-09-14 23:16", buildOutdated: false })).toBe("2026-09-14 23:16");
		expect(agentBuildLabel({ build: null, buildOutdated: null })).toBe("—");
	});

	it("недостающее — словами, незнакомое — как есть", () => {
		const labels = featureLabels(["health", "somethingNew"]);
		expect(labels).toHaveLength(2);
		expect(labels[0]).not.toBe("health");
		expect(labels[1]).toBe("somethingNew");
	});
});
