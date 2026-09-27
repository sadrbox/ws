// Права и изоляция организаций после аудита 26.09 (Б2, Б9, Б13, Б14, Н2) — без БД.
//
// Проверяются правила, которые до исправления пропускали чужое:
//   - админ ЛЮБОЙ организации получал безусловный доступ и «доступ» к любой организации;
//   - middleware прав и организаций при сбое БД пропускали запрос (fail-open);
//   - организация документа из тела не сверялась с доступными;
//   - запись без организации считалась общей для всех (в т.ч. документы).
// Обращения к БД подменяются на уровне делегатов Prisma — соединения с базой нет.
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma/prisma-client.js";
import {
	hasUnconditionalAccess, orgIsAccessible, isAdminOfOrg, resolveWritableOrg, OrgAccessError,
	checkOwnership, tenantMiddleware, accessPermissionMiddleware,
} from "../utils/auth.js";

const member = { uuid: "u1", username: "m", organizationUuid: "org-A", allowedOrgUuids: ["org-A", "org-B"], adminOrgUuids: [], isOrgAdmin: false };
const adminA = { uuid: "u2", username: "a", organizationUuid: "org-A", allowedOrgUuids: ["org-A", "org-B"], adminOrgUuids: ["org-A"], isOrgAdmin: true, isAnyOrgAdmin: true };

// ── Б2: безусловный доступ и доступность организации ────────────────────────
test("Б2: админ любой организации (isAnyOrgAdmin) не получает безусловный доступ", () => {
	assert.equal(hasUnconditionalAccess({ user: { uuid: "x", isAnyOrgAdmin: true, adminOrgUuids: ["org-Z"], organizationUuid: "org-B", allowedOrgUuids: ["org-B", "org-Z"] } }), false);
	assert.equal(hasUnconditionalAccess({ user: adminA }), true, "админ активной организации — да");
	assert.equal(hasUnconditionalAccess({ user: { isSuperAdmin: true } }), true);
});

test("Б2: сводный вид по группе — безусловно только админу КАЖДОЙ организации", () => {
	const groupReq = (user) => ({ user, headers: { "x-org-scope": "group" }, query: {} });
	assert.equal(hasUnconditionalAccess(groupReq(adminA)), false, "в org-B он рядовой участник");
	assert.equal(hasUnconditionalAccess(groupReq({ ...adminA, adminOrgUuids: ["org-A", "org-B"] })), true);
	// Активная не выбрана — то же правило.
	assert.equal(hasUnconditionalAccess({ user: { ...adminA, organizationUuid: null, isOrgAdmin: false } }), false);
});

test("Б2: orgIsAccessible — только свои и обслуживаемые; роль admin чужие не открывает", () => {
	assert.equal(orgIsAccessible({ user: adminA }, "org-A"), true);
	assert.equal(orgIsAccessible({ user: adminA }, "org-B"), true);
	assert.equal(orgIsAccessible({ user: adminA }, "org-VICTIM"), false, "раньше — true для любого uuid");
	assert.equal(orgIsAccessible({ user: { isSuperAdmin: true } }, "org-VICTIM"), true);
	// Режим поддержки (О5): суперадмину без открытых данных чужая организация недоступна.
	assert.equal(orgIsAccessible({ user: { isSuperAdmin: true, operatorDataAccess: false, allowedOrgUuids: [] } }, "org-VICTIM"), false);
});

test("Б2: isAdminOfOrg — по членству именно в этой организации", () => {
	assert.equal(isAdminOfOrg({ user: adminA }, "org-A"), true);
	assert.equal(isAdminOfOrg({ user: adminA }, "org-B"), false, "в org-B он участник");
	assert.equal(isAdminOfOrg({ user: member }, "org-A"), false);
	assert.equal(isAdminOfOrg({ user: adminA }, null), false);
});

// ── Б8: организация записываемого документа ─────────────────────────────────
test("Б8: resolveWritableOrg — чужая 403, пустая → активная, без активной 400", () => {
	assert.equal(resolveWritableOrg({ user: member }, "org-B"), "org-B");
	assert.equal(resolveWritableOrg({ user: member }, ""), "org-A", "не указана — активная");
	assert.throws(() => resolveWritableOrg({ user: member }, "org-VICTIM"), (e) => e instanceof OrgAccessError && e.status === 403);
	assert.throws(() => resolveWritableOrg({ user: { ...member, organizationUuid: null } }, null), (e) => e instanceof OrgAccessError && e.status === 400);
	assert.equal(resolveWritableOrg({ user: { isSuperAdmin: true } }, null), null, "суперадмину пустая — как было");
});

test("Б5/Б6: checkOwnership с allowShared:false — запись без организации не «общая»", () => {
	const req = { user: member };
	assert.equal(checkOwnership({ organizationUuid: null }, req), true, "справочник: общая запись по-прежнему видна");
	assert.equal(checkOwnership({ organizationUuid: null }, req, "organizationUuid", { allowShared: false }), false);
	assert.equal(checkOwnership({ organizationUuid: "org-VICTIM" }, req, "organizationUuid", { allowShared: false }), false);
	assert.equal(checkOwnership({ organizationUuid: "org-B" }, req, "organizationUuid", { allowShared: false }), true);
	assert.equal(checkOwnership({ organizationUuid: null }, { user: { isSuperAdmin: true } }, "organizationUuid", { allowShared: false }), true);
});

// ── Н2: отказ при сбое проверки ─────────────────────────────────────────────
function fakeRes() {
	return {
		statusCode: 200, body: null,
		status(c) { this.statusCode = c; return this; },
		json(b) { this.body = b; return this; },
	};
}

test("Н2: tenantMiddleware при ошибке БД отвечает 503, а не пропускает", async () => {
	const orig = prisma.user.findUnique;
	prisma.user.findUnique = async () => { throw new Error("db down"); };
	try {
		let passed = false;
		const res = fakeRes();
		await tenantMiddleware({ method: "GET", user: { uuid: "u1" } }, res, () => { passed = true; });
		assert.equal(passed, false);
		assert.equal(res.statusCode, 503);
	} finally {
		prisma.user.findUnique = orig;
	}
});

test("Н2: токен удалённого пользователя — 401, а не «гость без организаций»", async () => {
	const orig = prisma.user.findUnique;
	try {
		for (const row of [null, { uuid: "u1", deletedAt: new Date(), accessRights: [] }]) {
			prisma.user.findUnique = async () => row;
			let passed = false;
			const res = fakeRes();
			await tenantMiddleware({ method: "GET", user: { uuid: "u1" } }, res, () => { passed = true; });
			assert.equal(passed, false);
			assert.equal(res.statusCode, 401);
		}
	} finally {
		prisma.user.findUnique = orig;
	}
});

test("Н2: tenantMiddleware заполняет adminOrgUuids только по роли admin", async () => {
	const origU = prisma.user.findUnique;
	const origS = prisma.serviceAssignment.findMany;
	prisma.user.findUnique = async () => ({
		uuid: "u1", organizationUuid: "org-A", isSuperAdmin: false, deletedAt: null,
		accessRights: [{ organizationUuid: "org-A", role: "member" }, { organizationUuid: "org-Z", role: "admin" }],
	});
	prisma.serviceAssignment.findMany = async () => [];
	try {
		const req = { method: "GET", user: { uuid: "u1" } };
		await tenantMiddleware(req, fakeRes(), () => {});
		assert.deepEqual(req.user.adminOrgUuids, ["org-Z"]);
		assert.equal(req.user.isOrgAdmin, false, "в активной org-A он участник");
		assert.equal(hasUnconditionalAccess(req), false, "админство в org-Z не даёт прав в org-A");
	} finally {
		prisma.user.findUnique = origU;
		prisma.serviceAssignment.findMany = origS;
	}
});

test("Н2: accessPermissionMiddleware при ошибке БД — 503", async () => {
	const orig = prisma.accessPermission.findFirst;
	prisma.accessPermission.findFirst = async () => { throw new Error("db down"); };
	try {
		let passed = false;
		const res = fakeRes();
		await accessPermissionMiddleware({ method: "GET", path: "/sales", user: member, ip: "::1" }, res, () => { passed = true; });
		assert.equal(passed, false);
		assert.equal(res.statusCode, 503);
	} finally {
		prisma.accessPermission.findFirst = orig;
	}
});

// ── Б9: стандарт качества — группы ──────────────────────────────────────────
import { canManageGroup, groupCompositionDenied } from "../services/quality/access.js";

test("Б9: руководитель правит только свою группу и не входит в неё", () => {
	const ctx = { isAdmin: false, userUuid: "mgr" };
	assert.equal(canManageGroup(ctx, { managerUuid: "mgr" }), true);
	assert.equal(canManageGroup(ctx, { managerUuid: "other" }), false, "раньше руководитель правил ВСЕ группы");
	assert.equal(canManageGroup({ isAdmin: true, userUuid: "adm" }, { managerUuid: "other" }), true);
	assert.match(groupCompositionDenied(ctx, { managerUuid: "other", headUuid: null, members: [] }), /Руководителя группы назначает/);
	assert.match(groupCompositionDenied(ctx, { managerUuid: "mgr", headUuid: "mgr", members: [] }), /уровень выше/);
	assert.match(groupCompositionDenied(ctx, { managerUuid: "mgr", headUuid: "h", members: ["mgr"] }), /уровень выше/);
	assert.equal(groupCompositionDenied(ctx, { managerUuid: "mgr", headUuid: "h", members: ["a"] }), null);
});

// ── Б2: связь обслуживания требует нового согласия при смене условий ────────
import { linkNeedsReconfirm, upsertLink } from "../services/serviceLinks.js";

test("Б2: смена профиля/модулей/срока активной связи возвращает её в requested", () => {
	const active = { state: "active", profile: "service_accountant", modules: null, validUntil: null };
	assert.equal(linkNeedsReconfirm(active, { profile: "service_accountant", modules: null, validUntil: null }), false);
	assert.equal(linkNeedsReconfirm(active, { profile: "accountant", modules: null, validUntil: null }), true);
	assert.equal(linkNeedsReconfirm(active, { profile: "service_accountant", modules: "sales", validUntil: null }), true);
	assert.equal(linkNeedsReconfirm(active, { profile: "service_accountant", modules: null, validUntil: "2030-01-01" }), true);
	assert.equal(linkNeedsReconfirm({ ...active, state: "revoked" }, active), true, "возобновление — новое согласие");
	assert.equal(linkNeedsReconfirm(null, active), false);
});

test("Б2: профиль owner обслуживающей фирме не выдаётся", async () => {
	await assert.rejects(() => upsertLink({ serviceOrgUuid: "f", clientOrgUuid: "c", profile: "owner" }), /нельзя выдать/);
});

// ── Б13: личные события — только адресату ───────────────────────────────────
import { eventVisibleTo, streamChannels } from "../api/router/chatStream.js";
import { personalChannel } from "../services/quality/notify.js";

test("Б13: чужие уведомления и назначения задач не уходят в SSE", () => {
	assert.equal(eventVisibleTo({ type: "notify", userUuid: "u1" }, "u1"), true);
	assert.equal(eventVisibleTo({ type: "notify", userUuid: "u2" }, "u1"), false);
	assert.equal(eventVisibleTo({ type: "task", todo: { executorUuid: "u2" } }, "u1"), false);
	assert.equal(eventVisibleTo({ type: "task", todo: { executorUuid: "u1" } }, "u1"), true);
	assert.equal(eventVisibleTo({ type: "chat", message: {} }, "u1"), true, "чат организации — всем её сотрудникам");
});

test("Б13: подписка — членства + обслуживание + личный канал, без активной организации без членства", async () => {
	const db = {
		serviceAssignment: { findMany: async () => [{ link: { clientOrgUuid: "org-C", state: "active", validUntil: null, profile: "service_accountant", modules: null, uuid: "l1" } }] },
		organization: { findMany: async () => [{ uuid: "org-ALL-1" }, { uuid: "org-ALL-2" }] },
	};
	const ch = await streamChannels({ isSuperAdmin: false, accessRights: [{ organizationUuid: "org-A" }] }, "u1", { db });
	assert.deepEqual(ch.sort(), ["org-A", "org-C", personalChannel("u1")].sort());
});

// ── Б14: код привязки Telegram истекает ─────────────────────────────────────
import { linkCodeExpired, LINK_CODE_TTL_MS } from "../services/quality/telegram.js";

test("Б14: код привязки Telegram живёт ограниченное время", () => {
	const now = Date.parse("2026-09-26T12:00:00Z");
	assert.equal(linkCodeExpired({ updatedAt: new Date(now - 60_000) }, now), false);
	assert.equal(linkCodeExpired({ updatedAt: new Date(now - LINK_CODE_TTL_MS - 1) }, now), true);
	assert.equal(linkCodeExpired({}, now), true, "без даты выдачи — недействителен");
});

// ── Б14: классификаторы — суперадмин ДО приёма файла ────────────────────────
import { requireSuperAdminBeforeUpload } from "../api/router/classifiers.js";

test("Б14: импорт классификаторов отклоняется до multer (файл не пишется на диск)", () => {
	for (const [user, code] of [[null, 401], [{ uuid: "u1" }, 403]]) {
		let passed = false;
		const res = fakeRes();
		requireSuperAdminBeforeUpload({ user }, res, () => { passed = true; });
		assert.equal(passed, false);
		assert.equal(res.statusCode, code);
	}
	let passed = false;
	requireSuperAdminBeforeUpload({ user: { uuid: "s", isSuperAdmin: true } }, fakeRes(), () => { passed = true; });
	assert.equal(passed, true);
});

// ── Б12: умолчания и права доступа ──────────────────────────────────────────
import { canTouchDefault } from "../api/router/userdefaults.js";
import { permissionVisible, permissionWritable } from "../api/router/accesspermissions.js";

test("Б12: умолчания — свои в доступной организации или участника своей организации (админ)", () => {
	assert.equal(canTouchDefault({ user: member }, { userUuid: "u1", organizationUuid: "org-A" }), true);
	assert.equal(canTouchDefault({ user: member }, { userUuid: "u1", organizationUuid: "org-VICTIM" }), false);
	assert.equal(canTouchDefault({ user: member }, { userUuid: "u9", organizationUuid: "org-A" }), false, "чужие — нет");
	assert.equal(canTouchDefault({ user: adminA }, { userUuid: "u9", organizationUuid: "org-A" }), true);
	assert.equal(canTouchDefault({ user: adminA }, { userUuid: "u9", organizationUuid: "org-B" }), false);
});

test("Б12: права доступа — раздаёт админ организации, глобальные — суперадмин", () => {
	assert.equal(permissionWritable({ user: adminA }, "org-A"), true);
	assert.equal(permissionWritable({ user: adminA }, "org-B"), false);
	assert.equal(permissionWritable({ user: adminA }, null), false, "глобальное право — только суперадмин");
	assert.equal(permissionWritable({ user: member }, "org-A"), false, "право на модель AccessPermission власти не даёт");
	assert.equal(permissionVisible({ user: member }, { userUuid: "u1", organizationUuid: null }), true, "свои глобальные — видны");
	assert.equal(permissionVisible({ user: member }, { userUuid: "u9", organizationUuid: "org-A" }), false);
	assert.equal(permissionVisible({ user: adminA }, { userUuid: "u9", organizationUuid: "org-A" }), true);
	assert.equal(permissionVisible({ user: adminA }, { userUuid: "u9", organizationUuid: null }), false);
});

// ── Б1: правила офлайн-обмена ───────────────────────────────────────────────
import { pushRefusal, filterPushData, PULL_TABLES, PUSH_TABLES } from "../api/router/sync.js";

test("Б1: push отказывает пользователям, правам, документам и задачам", () => {
	assert.match(pushRefusal("users"), /Пользователи и права/);
	assert.match(pushRefusal("access-permissions"), /Пользователи и права/);
	assert.match(pushRefusal("sales"), /Документ нельзя записать офлайн/);
	assert.match(pushRefusal("cash-receipt-orders"), /Документ/);
	assert.match(pushRefusal("todos"), /Задачи офлайн/);
	assert.match(pushRefusal("whatever"), /не синхронизируется/);
	assert.equal(pushRefusal("counterparties"), null);
	for (const t of ["users", "access-permissions", "organizations", "sales"]) assert.ok(!(t in PUSH_TABLES), t);
});

test("Б1: push пишет только белый список полей; менять связь с 1С и учётные флаги нельзя", () => {
	const r = filterPushData("counterparty", { name: "ТОО", bin: "123", uuid: "x", updatedAt: "…", counterpartyName: "подпись", organization: { a: 1 } });
	assert.deepEqual(r.data, { name: "ТОО", bin: "123" });
	assert.deepEqual(r.rejected, []);
	assert.deepEqual(filterPushData("product", { trackSerialNumbers: true }).rejected, ["trackSerialNumbers"]);
	assert.deepEqual(filterPushData("product", { trackSerialNumbers: false }, { trackSerialNumbers: false }).rejected, [], "не изменено — не попытка");
	assert.deepEqual(filterPushData("counterparty", { externalId: "1C-42" }).rejected, ["externalId"]);
});

test("Б1: pull — белый список ровно по панели; пользователи и права — особые правила", () => {
	assert.equal(PULL_TABLES.users.scope, "users");
	assert.equal(PULL_TABLES["access-permissions"].scope, "ownPerm");
	assert.equal(PULL_TABLES.importdeclarations, undefined, "лишние таблицы больше не отдаются");
});

// ── И24: возражение по нарушению решает уровень выше подтвердившего ──────────
import { roleLevelOver, disputeResolveDenied, buildContext } from "../services/quality/access.js";

test("И24: уровень роли над сотрудником — главбух 1, руководитель 2, администратор 3", () => {
	const groups = [{ uuid: "g1", headUuid: "head", managerUuid: "mgr", members: [{ userUuid: "acc" }], clients: [] }];
	assert.equal(roleLevelOver(groups, "head", "acc"), 1);
	assert.equal(roleLevelOver(groups, "mgr", "acc"), 2);
	assert.equal(roleLevelOver(groups, "mgr", "head"), 2, "руководитель — уровень и над главбухом");
	assert.equal(roleLevelOver(groups, "head", "mgr"), 0);
	assert.equal(roleLevelOver(groups, "other", "acc"), 0);
	assert.equal(roleLevelOver(groups, "x", "acc", { isAdmin: true }), 3);
});

test("И24: решает не подтвердивший и не его уровень; администратор — всегда", async () => {
	const groups = [
		{ uuid: "g1", headUuid: "head", managerUuid: "mgr", members: [{ userUuid: "acc" }], clients: [] },
		{ uuid: "g2", headUuid: "head2", managerUuid: "mgr", members: [{ userUuid: "acc" }], clients: [] },
	];
	const ctxOf = (userUuid, isAdmin = false) => buildContext({ firmOrgUuid: "org-F", userUuid, isAdmin, groups });
	const orig = prisma.accessRight.findUnique;
	prisma.accessRight.findUnique = async () => ({ role: "member" });
	try {
		const v = { userUuid: "acc", decidedByUuid: "head", status: "disputed" };
		assert.match(await disputeResolveDenied(ctxOf("head"), v), /не тот, кто подтверждал/);
		assert.match(await disputeResolveDenied(ctxOf("head2"), v), /уровень выше/, "второй главбух — тот же уровень (раньше проходил)");
		assert.equal(await disputeResolveDenied(ctxOf("mgr"), v), null, "руководитель — уровнем выше");
		assert.equal(await disputeResolveDenied(ctxOf("adm", true), v), null, "администратор фирмы — всегда");
		assert.match(await disputeResolveDenied(ctxOf("mgr"), { ...v, decidedByUuid: "mgr" }), /не тот, кто подтверждал/);
		assert.match(await disputeResolveDenied(ctxOf("acc"), v), /Решает главбух/, "сам сотрудник не решает");
		assert.equal(await disputeResolveDenied(ctxOf("head"), { ...v, decidedByUuid: null }), null, "подтверждавшего нет — любой, кто решает");
		prisma.accessRight.findUnique = async () => ({ role: "admin" });
		assert.match(await disputeResolveDenied(ctxOf("mgr"), { ...v, decidedByUuid: "adm" }), /администратор фирмы/, "подтвердил администратор — только администратор");
	} finally {
		prisma.accessRight.findUnique = orig;
	}
});
