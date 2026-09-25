// E17 СК0.2: группы сотрудников — состав группы и тело запроса (сервер заменяет состав целиком).
import { describe, it, expect } from "vitest";
import {
	addClient, addMember, clientsOf, membersOf, removeClient, removeMember, setResponsible, staffGroupPayload, validateStaffGroup,
	type StaffGroupFields,
} from "src/models/StaffGroups/staffGroups";

describe("состав группы", () => {
	it("участники: без повторов, удаление по uuid", () => {
		let m = addMember([], { userUuid: "u-1", userName: "Иванова" });
		m = addMember(m, { userUuid: "u-1", userName: "Иванова" });
		m = addMember(m, { userUuid: "u-2", userName: "Петрова" });
		m = addMember(m, { userUuid: "", userName: "?" });
		expect(m.map((x) => x.userUuid)).toEqual(["u-1", "u-2"]);
		expect(removeMember(m, "u-1").map((x) => x.userUuid)).toEqual(["u-2"]);
	});

	it("клиенты: один клиент — одна строка, ответственный меняется у своей строки", () => {
		let c = addClient([], { clientOrganizationUuid: "o-1", clientName: "ТОО А" });
		c = addClient(c, { clientOrganizationUuid: "o-1", clientName: "ТОО А" });
		c = addClient(c, { clientOrganizationUuid: "o-2", clientName: "ТОО Б" });
		expect(c).toHaveLength(2);
		c = setResponsible(c, "o-2", "u-2", "Петрова");
		expect(c[1]).toEqual({ clientOrganizationUuid: "o-2", clientName: "ТОО Б", responsibleUuid: "u-2", responsibleName: "Петрова" });
		expect(c[0].responsibleUuid).toBe("");
		expect(removeClient(c, "o-1").map((x) => x.clientOrganizationUuid)).toEqual(["o-2"]);
	});

	it("из записи сервера: имена подставлены, пустой ответственный — пустая строка", () => {
		const rec = {
			members: [{ userUuid: "u-1", userName: "Иванова" }, { userUuid: "u-9" }],
			clients: [{ clientOrganizationUuid: "o-1", clientName: "ТОО А", responsibleUuid: null, responsibleName: null }],
		};
		expect(membersOf(rec)).toEqual([{ userUuid: "u-1", userName: "Иванова" }, { userUuid: "u-9", userName: "u-9" }]);
		expect(clientsOf(rec)).toEqual([{ clientOrganizationUuid: "o-1", clientName: "ТОО А", responsibleUuid: "", responsibleName: "" }]);
		expect(membersOf({})).toEqual([]);
	});
});

describe("запись группы", () => {
	const fields: StaffGroupFields = {
		name: "  Группа 1 ", headUuid: "u-h", managerUuid: "u-m", comment: " ",
		members: [{ userUuid: "u-1", userName: "Иванова" }, { userUuid: "u-2", userName: "Петрова" }],
		clients: [
			{ clientOrganizationUuid: "o-1", clientName: "ТОО А", responsibleUuid: "u-1", responsibleName: "Иванова" },
			{ clientOrganizationUuid: "o-2", clientName: "ТОО Б", responsibleUuid: "", responsibleName: "" },
		],
	};

	it("проверка: название обязательно, главбух и руководитель — разные люди", () => {
		expect(validateStaffGroup(fields)).toBeNull();
		expect(validateStaffGroup({ ...fields, name: "  " })).toBe("staffGroupNeedName");
		expect(validateStaffGroup({ ...fields, managerUuid: "u-h" })).toBe("staffGroupHeadIsManager");
		expect(validateStaffGroup({ ...fields, headUuid: "", managerUuid: "" })).toBeNull();
	});

	it("тело — весь состав: участники uuid-ами, клиенты с ответственным или null", () => {
		expect(staffGroupPayload(fields)).toEqual({
			name: "Группа 1", headUuid: "u-h", managerUuid: "u-m", comment: null,
			members: ["u-1", "u-2"],
			clients: [{ clientOrganizationUuid: "o-1", responsibleUuid: "u-1" }, { clientOrganizationUuid: "o-2", responsibleUuid: null }],
		});
		expect(staffGroupPayload({ ...fields, members: [], clients: [] })).toMatchObject({ members: [], clients: [] });
	});
});
