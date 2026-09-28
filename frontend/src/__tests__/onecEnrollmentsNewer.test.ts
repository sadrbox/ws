/**
 * КР-20 аудита 27.09: заявку агента (базы), у которой есть более новая ожидающая той же службы (базы), одобрить нельзя —
 * агент сборки 19.09 и старое расширение повторяют заявку без секрета опроса и ждут решения по новой. Правила
 * отображения без JSX.
 */
import { describe, expect, it } from "vitest";
import { translate } from "src/i18";
import { approveBlockReason, siblingsCell } from "src/models/OneCAdmin/enrollmentsView";
import { registrationApproveBlock, registrationNewerMark } from "src/models/OneCAdmin/requestsView";

describe("более новая заявка той же службы", () => {
	it("прежнюю не одобрить: причина называет код новой и код этой; у самой новой и у решённой — можно", () => {
		const reason = approveBlockReason({ state: "PENDING", code: "OLD-001", newerPendingCode: "NEW-002" });
		expect(reason).toBe(translate("onecEnrollNewerPending").replace(/\{code\}/g, "NEW-002").replace("{own}", "OLD-001"));
		expect(reason).toContain("NEW-002");
		expect(reason).toContain("OLD-001");
		expect(approveBlockReason({ state: "PENDING", code: "NEW-002", newerPendingCode: null })).toBeNull();
		expect(approveBlockReason({ state: "REJECTED", code: "OLD-001", newerPendingCode: "NEW-002" })).toBeNull();
		// Старый сервис поля не отдаёт — не мешаем (сервис всё равно проверит при одобрении).
		expect(approveBlockReason({ state: "PENDING", code: "OLD-001" })).toBeNull();
	});

	it("колонка «Ещё заявки службы»: код более новой важнее счётчика", () => {
		expect(siblingsCell({ state: "PENDING", pendingSiblings: 1, newerPendingCode: "NEW-002" })).toBe(`${translate("onecEnrollNewerShort")} NEW-002`);
		expect(siblingsCell({ state: "PENDING", pendingSiblings: 1, newerPendingCode: null })).toBe(`1 — ${translate("onecEnrollSiblingsShort")}`);
		expect(siblingsCell({ state: "APPROVED", pendingSiblings: 0 })).toBe("—");
	});
});

describe("более новая заявка той же базы", () => {
	it("прежнюю не одобрить: причина называет код новой и код этой; у самой новой, решённой и без поля — можно", () => {
		const reason = registrationApproveBlock({ state: "PENDING", code: "OLD-001", newerPendingCode: "NEW-777" });
		expect(reason).toBe(translate("onecReqNewerPending").replace(/\{code\}/g, "NEW-777").replace("{own}", "OLD-001"));
		expect(reason).toContain("NEW-777");
		expect(reason).toContain("OLD-001");
		expect(registrationApproveBlock({ state: "PENDING", code: "NEW-777", newerPendingCode: null })).toBeNull();
		expect(registrationApproveBlock({ state: "APPROVED", code: "OLD-001", newerPendingCode: "NEW-777" })).toBeNull();
		expect(registrationApproveBlock({ state: "PENDING", code: "OLD-001" })).toBeNull();
	});

	it("пометка в строке — код более новой заявки; у решённой и без новой — нет", () => {
		expect(registrationNewerMark({ state: "PENDING", newerPendingCode: "NEW-777" })).toBe(`${translate("onecEnrollNewerShort")} NEW-777`);
		expect(registrationNewerMark({ state: "PENDING", newerPendingCode: null })).toBeNull();
		expect(registrationNewerMark({ state: "REJECTED", newerPendingCode: "NEW-777" })).toBeNull();
	});
});
