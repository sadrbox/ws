/**
 * Организации баз, ждущие одобрения (Б11 аудита 26.09), и предупреждение о нескольких заявках одной службы —
 * правила отображения без JSX.
 */
import { describe, expect, it } from "vitest";
import { translate } from "src/i18";
import { baseOrgTitle, baseText, pendingOrgKey, pendingOrgRows } from "src/models/OneCAdmin/baseOrganizationsView";
import { siblingsCount, siblingsWarning } from "src/models/OneCAdmin/enrollmentsView";
import type { PendingBaseOrganization } from "src/services/onec/api";

const org = (over: Partial<PendingBaseOrganization> = {}): PendingBaseOrganization => ({
	baseId: "b1b1b1b1-0000-0000-0000-000000000001", baseKey: "buh_nord", baseName: "Nord Beer", server: "srv1c",
	bin: "180240037695", name: "ТОО Nord Beer", onecId: null, requestedAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z", ...over,
});

describe("организации баз, ждущие одобрения", () => {
	it("строка: организация ERP по БИН (с пробелами в ERP) — «БИН совпал», иначе «нет в ERP»", () => {
		const rows = pendingOrgRows(
			[org(), org({ bin: "990000000001", name: null, baseKey: null, baseName: null, server: null })],
			[{ uuid: "o-1", name: "ТОО Nord Beer", bin: "180 240 037 695" }],
		);
		expect(rows[0]).toMatchObject({
			uuid: pendingOrgKey(org()), bin: "180240037695", organizationName: "ТОО Nord Beer", onecBase: "buh_nord — Nord Beer",
			onecServer: "srv1c", onecReqErpOrg: `ТОО Nord Beer — ${translate("onecReqBinMatch")}`, __erp: true,
		});
		expect(rows[1]).toMatchObject({ organizationName: "—", onecBase: "—", onecServer: "—", onecReqErpOrg: translate("onecReqOrgMissing"), __erp: false });
	});

	it("база словами и подпись организации для подтверждения", () => {
		expect(baseText({ baseKey: "buh", baseName: "buh" })).toBe("buh");
		expect(baseText({ baseKey: null, baseName: null })).toBe("—");
		expect(baseOrgTitle(org())).toBe("«ТОО Nord Beer» (180240037695) — buh_nord");
		expect(baseOrgTitle(org({ name: null, baseKey: null }))).toBe("«—» (180240037695) — b1b1b1b1");
	});
});

describe("несколько ожидающих заявок одной службы", () => {
	it("предупреждение только у ожидающей заявки с соседями; старый сервис без поля — молчим", () => {
		expect(siblingsCount({ state: "PENDING", pendingSiblings: 2 })).toBe(2);
		expect(siblingsCount({ state: "APPROVED", pendingSiblings: 2 })).toBe(0);
		expect(siblingsCount({ state: "PENDING" })).toBe(0);
		expect(siblingsWarning({ state: "PENDING", pendingSiblings: 2 })).toBe(translate("onecEnrollSiblingsWarn").replace("{n}", "2"));
		expect(siblingsWarning({ state: "PENDING", pendingSiblings: 0 })).toBeNull();
	});
});
