/**
 * Заявки на подключение баз (СВ4): что панель предлагает при одобрении и как называет базу и состояние.
 *
 * Одобрение по умолчанию — организация ERP с совпавшим БИН и единственная база реестра с тем же ключом; при
 * нескольких базах выбирает человек (сервис иначе ответит BASE_AMBIGUOUS).
 */
import { describe, expect, it } from "vitest";
import { approveDefaults, organizationOptions, stateTone, whereText } from "src/models/OneCAdmin/requestsView";
import type { BaseRegistration } from "src/services/onec/api";

const reg = (over: Partial<BaseRegistration> = {}): BaseRegistration => ({
	id: "r1", code: "K7M-42Q", state: "PENDING", note: null,
	base: { id: "ib", name: "Бух_Альфа", kind: "server", server: "srv-1c", computer: "SRV-1C" },
	user: null, contact: null, comment: null,
	organizations: [{ name: "ТОО Альфа", bin: "123456789012", erp: { uuid: "erp-a", name: "ТОО Альфа", bin: "123456789012" } }],
	ip: null, repeats: 0, createdAt: "2026-09-19T10:00:00Z", expiresAt: "2026-09-26T10:00:00Z",
	decidedBy: null, decidedAt: null, organizationUuid: null, baseKey: null, tokenDelivered: false,
	suggestion: { organizationUuid: "erp-a", baseKey: "Бух_Альфа", candidates: [{ baseId: "b1", key: "Бух_Альфа", server: "SRV" }] },
	...over,
});

describe("заявки на подключение: подсказки одобрения", () => {
	it("одна база реестра — выбрана сразу; несколько — выбирает человек", () => {
		expect(approveDefaults(reg())).toEqual({ organizationUuid: "erp-a", baseKey: "Бух_Альфа", baseId: "b1" });
		const two = reg({ suggestion: { organizationUuid: null, baseKey: "Бух_Альфа", candidates: [
			{ baseId: "b1", key: "Бух_Альфа", server: "A" }, { baseId: "b2", key: "Бух_Альфа", server: "B" },
		] } });
		expect(approveDefaults(two)).toEqual({ organizationUuid: "", baseKey: "Бух_Альфа", baseId: "" });
	});

	it("организации ERP: совпавшие по БИН — первыми, после пустого варианта", () => {
		const opts = organizationOptions([
			{ uuid: "erp-b", name: "ТОО Бета", bin: "999999999999" },
			{ uuid: "erp-a", name: "ТОО Альфа", bin: "123456789012" },
		], reg());
		expect(opts.map((o) => o.value)).toEqual(["", "erp-a", "erp-b"]);
	});

	it("где база: сервер и компьютер; файловая — словом", () => {
		expect(whereText(reg())).toBe("srv-1c · SRV-1C");
		expect(whereText(reg({ base: { id: "ib", name: "x", kind: "file", computer: "PC-7" } }))).toMatch(/PC-7$/);
		expect([stateTone("PENDING"), stateTone("APPROVED"), stateTone("REJECTED"), stateTone("EXPIRED")]).toEqual(["wait", "ok", "bad", "off"]);
	});
});
