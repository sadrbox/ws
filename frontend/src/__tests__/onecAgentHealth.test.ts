/**
 * Состояние сервера 1С словами (R1) и сборка агента (R3): таблица показывает только пришедшее,
 * а требующее внимания отмечает.
 */
import { describe, expect, it } from "vitest";
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
