import { describe, expect, it } from "vitest";
import { buildPaneUniqId } from "src/app/paneUniqId";

describe("buildPaneUniqId", () => {
	it("использует uuid/id для одной и той же записи", () => {
		expect(buildPaneUniqId("OrganizationsForm", { uuid: "org-1" })).toBe(
			"OrganizationsForm-org-1",
		);
		expect(buildPaneUniqId("OrganizationsForm", { id: 7 })).toBe(
			"OrganizationsForm-7",
		);
	});

	it("делает разные uniqId для разных данных без uuid/id", () => {
		const first = buildPaneUniqId("OrganizationsForm", {
			organizationUuid: "org-1",
		});
		const second = buildPaneUniqId("OrganizationsForm", {
			organizationUuid: "org-2",
		});
		expect(first).not.toBe(second);
		expect(first).toContain("OrganizationsForm-");
		expect(second).toContain("OrganizationsForm-");
	});

	it("сохраняет синглтон для списков", () => {
		expect(buildPaneUniqId("OrganizationsList", {})).toBe("OrganizationsList");
	});

	it("различает формы по вложенным данным, а не только по верхнему уровню", () => {
		const first = buildPaneUniqId("SalesForm", {
			fromBasisFields: {
				number: "РЕАЛ-ДЕМО-СЕРИИ-ПАРТИИ",
				date: "2026-07-15",
			},
		});
		const second = buildPaneUniqId("SalesForm", {
			fromBasisFields: {
				number: "ID 965",
				date: "2026-07-15",
			},
		});

		expect(first).not.toBe(second);
	});
});
