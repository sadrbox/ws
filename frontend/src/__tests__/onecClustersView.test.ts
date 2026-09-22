/**
 * «Кластеры 1С»: список кластеров и выбор текущего (21.09).
 *
 * Кластер — сервер 1С из реестра, и у него может не быть админ-агента: тогда кластерные команды выполнять некому,
 * и это видно в строке. Выбор кластера переживает перезагрузку, но исчезнувший сервер не должен «залипать».
 */
import { describe, expect, it } from "vitest";
import { agentOfServer, clusterOptions, clusterRows, clusterSubtitle, pickCluster } from "src/models/OneCAdmin/clustersView";
import type { OnecAgent, OnecServer } from "src/services/onec/api";

const server = (over: Partial<OnecServer> = {}): OnecServer => ({
	id: "s1", name: "SRV-A", publicHost: "buh.local", rasHost: "127.0.0.1", rasPort: 1545, bases: 12, ...over,
});
const agent = (over: Partial<OnecAgent> = {}): OnecAgent => ({
	id: "a1", name: "Кластер SRV-A", role: "admin", online: true, capabilities: [], lastSeenAt: null, disabled: false,
	serverId: "s1", platform: null, busy: false, instances: [], owner: { instanceId: null, seenAt: null }, ...over,
} as OnecAgent);

describe("кластеры 1С", () => {
	it("строка кластера: имя, его админ-агент, число баз и адреса", () => {
		const [row] = clusterRows([server()], [agent()]);
		expect(row.uuid).toBe("s1");
		expect(row.clusterName).toBe("SRV-A");
		expect(row.clusterBases).toBe(12);
		expect(row.clusterAddress).toContain("buh.local");
		expect(row.clusterAddress).toContain("RAS 127.0.0.1:1545");
		expect(row.online).toBe(true);
	});

	it("кластер без админ-агента виден и назван: командовать им некому", () => {
		const [row] = clusterRows([server()], [agent({ serverId: "s2" })]);
		expect(row.online).toBe(false);
		expect(row.clusterAgent).not.toContain("Кластер SRV-A");
		// Отключённый агент команд не получает, но он ЕСТЬ: строка должна сказать «отключён», а не «агента нет» —
		// лечится это включением, а не регистрацией новой службы.
		const [off] = clusterRows([server()], [agent({ disabled: true })]);
		expect(off.online).toBe(false);
		expect(off.clusterAgent).toContain("Кластер SRV-A");
		expect(agentOfServer([agent({ disabled: true })], "s1")?.disabled).toBe(true);
		// Бизнес-агент того же сервера кластером не управляет.
		expect(agentOfServer([agent({ role: "business" })], "s1")).toBeNull();
	});

	it("выбор кластера: прежний — если он есть; иначе первый; пусто — когда серверов нет", () => {
		const rows = clusterRows([server(), server({ id: "s2", name: "SRV-B" })], []);
		expect(pickCluster(rows, "s2")).toBe("s2");
		expect(pickCluster(rows, "исчез")).toBe("s1");
		expect(pickCluster([], "s1")).toBeNull();
	});
});

describe("СП4: рабочее место бизнес-агента — не кластер", () => {
	it("сервер без админ-агента и без баз в списке кластеров не показывается", () => {
		const workplace = server({ id: "s9", name: "BUH-PC", bases: 0 });
		const rows = clusterRows([server(), workplace], [agent()]);
		expect(rows.map((r) => r.uuid)).toEqual(["s1"]);
	});

	it("кластер, где админ-агент ещё не прислал базы, остаётся в списке", () => {
		const rows = clusterRows([server({ bases: 0 })], [agent()]);
		expect(rows).toHaveLength(1);
	});

	it("сервер с базами, но без агента, — тоже кластер: агента могли удалить", () => {
		const rows = clusterRows([server({ bases: 4 })], []);
		expect(rows).toHaveLength(1);
		expect(rows[0].clusterAgent).not.toContain("Кластер");
	});
});

describe("выбор кластера в тулбаре панели", () => {
	it("в подписи опции — только имя кластера: подробности стоят рядом с полем", () => {
		const rows = clusterRows([server(), server({ id: "s2", name: "SRV-B", bases: 3 })], [agent()]);
		expect(clusterOptions(rows)).toEqual([
			{ value: "s1", label: "SRV-A" },
			{ value: "s2", label: "SRV-B" },
		]);
	});

	it("строка рядом с выбором называет адрес и число баз — этим кластеры и различают", () => {
		const [row] = clusterRows([server()], [agent()]);
		const subtitle = clusterSubtitle(row);
		expect(subtitle).toContain("buh.local");
		expect(subtitle).toContain("12");
	});
});
