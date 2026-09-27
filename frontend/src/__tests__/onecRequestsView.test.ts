/**
 * Заявки на подключение баз (СВ4): что панель предлагает при одобрении и как называет базу и состояние.
 *
 * Одобрение по умолчанию — организация ERP с совпавшим БИН и единственная база реестра с тем же ключом; при
 * нескольких базах выбирает человек (сервис иначе ответит BASE_AMBIGUOUS).
 */
import { describe, expect, it } from "vitest";
import {
	approveDefaults, missingOrganizations, orgDetailsLines, organizationOptions, registrationBin, stateTone, whereText,
} from "src/models/OneCAdmin/requestsView";
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

describe("заявки на подключение: организации, которых нет в ERP (26.09)", () => {
	const nord = { id: "o2", name: "ТОО Nord Beer", bin: "180240037695", erp: null };

	it("в список попадают только организации без пары в ERP; БИН — по цифрам, без БИН создать нельзя", () => {
		const r = reg({ organizations: [...reg().organizations, nord, { name: "ИП без БИН", bin: " ", erp: null }] });
		expect(missingOrganizations(r).map((m) => [m.org.name, m.bin])).toEqual([["ТОО Nord Beer", "180240037695"], ["ИП без БИН", null]]);
		expect(missingOrganizations(reg())).toEqual([]);
		expect(registrationBin("180 240 037 695")).toBe("180240037695");
		expect(registrationBin("12345")).toBeNull();
	});

	it("реквизиты строками: пустое не показывается, фактический адрес, равный юридическому, — тоже", () => {
		expect(orgDetailsLines(null)).toEqual([]);
		const lines = orgDetailsLines({
			legalName: "ТОО «Nord Beer»", kind: "legal", kbe: "17", vatSeries: "60001", vatNumber: "0012345", vatDate: null,
			okedCode: null, okedName: null, legalAddress: "г. Алматы, ул. Абая, 1", actualAddress: "г. Алматы, ул. Абая, 1",
			phones: ["+7 701 000 00 00"], emails: [], website: null,
			director: { fullName: "Иванов И. И.", position: "Директор" }, chiefAccountant: null,
			bankAccounts: [{ iban: "KZ111111111111111111", bik: "HSBKKZKX", bankName: "Халык", currency: "KZT", isPrimary: true }],
		});
		const values = lines.map((l) => l.value);
		expect(values).toContain("ТОО «Nord Beer»");
		expect(values).toContain("60001 № 0012345");
		expect(values).toContain("Иванов И. И., Директор");
		expect(values).toContain("KZ111111111111111111 · Халык · KZT");
		expect(values.filter((v) => v === "г. Алматы, ул. Абая, 1")).toHaveLength(1);
		expect(lines.every((l) => l.value !== "")).toBe(true);
	});
});
