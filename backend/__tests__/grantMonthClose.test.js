// КР-19 аудита 27.09: разовый скрипт prisma/grant-monthclose.js (MonthClose тем, у кого есть
// AccountingEntry) и профили новых назначений — HEADLESS, без БД (план — чистая функция).
import { test } from "node:test";
import assert from "node:assert/strict";
import { planMonthCloseGrants, rankOf } from "../prisma/grant-monthclose.js";
import { expandProfile } from "../services/permissionProfiles.js";
import { ROUTE_TO_MODEL } from "../utils/routeModels.js";

const ae = (userUuid, organizationUuid, accessLevel) => ({ userUuid, organizationUuid, accessLevel });

test("КР-19: MonthClose выдаётся того же уровня, что AccountingEntry; выданное выше — не понижается", () => {
	const plan = planMonthCloseGrants(
		[ae("u1", "o1", "full"), ae("u2", "o1", "readonly"), ae("u3", "o1", "readonly"), ae("u4", "o2", "full"), ae("u5", null, "full"), ae("u6", "o1", "none")],
		[ae("u3", "o1", "full"), ae("u4", "o2", "readonly")],
	);
	assert.deepEqual(plan.create.map((r) => [r.userUuid, r.organizationUuid, r.to]), [["u1", "o1", "full"], ["u2", "o1", "readonly"], ["u5", null, "full"]]);
	assert.deepEqual(plan.raise.map((r) => [r.userUuid, r.from, r.to]), [["u4", "readonly", "full"]]);
	assert.deepEqual(plan.unchanged.map((r) => [r.userUuid, r.level]), [["u3", "full"]], "full при readonly у проводок — не понижаем");
	assert.ok(!plan.create.some((r) => r.userUuid === "u6"), "нет права на проводки — нечего выдавать");
});

test("КР-19: пара в разных организациях — отдельно; дубли глобальных прав — по наибольшему уровню; повторный план пуст", () => {
	const src = [ae("u1", "o1", "full"), ae("u1", "o2", "readonly"), ae("u1", null, "readonly"), ae("u1", null, "full")];
	const plan = planMonthCloseGrants(src, [ae("u1", null, "readonly"), ae("u1", null, "none")]);
	assert.deepEqual(plan.create.map((r) => [r.organizationUuid, r.to]), [["o1", "full"], ["o2", "readonly"]]);
	assert.deepEqual(plan.raise.map((r) => [r.organizationUuid, r.from, r.to]), [[null, "readonly", "full"]]);
	// После выдачи: всё уже не ниже — второй запуск ничего не делает.
	const after = planMonthCloseGrants(src, [ae("u1", "o1", "full"), ae("u1", "o2", "readonly"), ae("u1", null, "full")]);
	assert.equal(after.create.length + after.raise.length, 0);
	assert.equal(rankOf("мусор"), 0);
});

test("КР-19: новые назначения получают MonthClose из профиля — бухгалтер, обслуживающий бухгалтер, владелец", () => {
	assert.equal(ROUTE_TO_MODEL["month-closes"], "MonthClose", "маршрут закрытия месяца под правом MonthClose");
	assert.equal(expandProfile("accountant").MonthClose, "full");
	assert.equal(expandProfile("service_accountant").MonthClose, "full");
	assert.equal(expandProfile("owner").MonthClose, "full");
	assert.equal(expandProfile("viewer").MonthClose, "readonly");
	assert.equal(expandProfile("cashier").MonthClose, "none");
	// Как и у проводок: профиль, дающий проводки, даёт и закрытие месяца.
	for (const code of ["owner", "accountant", "storekeeper", "cashier", "sales", "manager", "viewer", "service_accountant"]) {
		const p = expandProfile(code);
		assert.equal(p.MonthClose, p.AccountingEntry, code);
	}
});
