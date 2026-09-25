// ─────────────────────────────────────────────────────────────────────────────
// E17 СК0.2 — группы сотрудников фирмы и справочник типовых ошибок.
//
//   GET|POST /staff-groups, GET|PUT|DELETE /staff-groups/:id
//     Группа: главбух (headUuid), руководитель (managerUuid), участники (members[]) и клиенты
//     с ответственным бухгалтером (clients[] = {clientOrganizationUuid, responsibleUuid}).
//     При сохранении members/clients заменяются целиком — форма присылает весь состав.
//   GET|POST /error-types, GET|PUT|DELETE /error-types/:id
//     Типовые ошибки: по типу ловится повтор уже разобранной ошибки (п. 6).
//
// Читать могут все сотрудники фирмы (orgIsAccessible), менять группы — администратор или
// руководитель, типовые ошибки — ещё и главбух.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { orgIsAccessible } from "../../utils/auth.js";
import { recordAudit } from "../../services/auditLog.js";
import { qualityContext, canManage, userNames, orgNames } from "../../services/quality/access.js";
import { listQuery, pageArgs, listResponse, fail, handler, text } from "../../services/quality/http.js";

const router = express.Router();

const byParam = (id) => {
	const n = Number(id);
	return Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(id) };
};

async function decorateGroup(g) {
	const users = await userNames([g.headUuid, g.managerUuid, ...g.members.map((m) => m.userUuid), ...g.clients.map((c) => c.responsibleUuid)]);
	const orgs = await orgNames(g.clients.map((c) => c.clientOrganizationUuid));
	return {
		...g,
		headName: users.get(g.headUuid) ?? null,
		managerName: users.get(g.managerUuid) ?? null,
		members: g.members.map((m) => ({ ...m, userName: users.get(m.userUuid) ?? m.userUuid })),
		clients: g.clients.map((c) => ({ ...c, clientName: orgs.get(c.clientOrganizationUuid) ?? c.clientOrganizationUuid, responsibleName: users.get(c.responsibleUuid) ?? null })),
		membersCount: g.members.length,
		clientsCount: g.clients.length,
	};
}

/** Проверить и нормализовать состав группы из тела. Возвращает { members, clients } или бросает строку. */
function compositionOf(req, body) {
	const members = [...new Set((Array.isArray(body.members) ? body.members : []).map((m) => (typeof m === "string" ? m : m?.userUuid)).filter(Boolean))];
	const seen = new Set();
	const clients = [];
	for (const c of Array.isArray(body.clients) ? body.clients : []) {
		const org = c?.clientOrganizationUuid;
		if (!org || seen.has(org)) continue;
		if (!orgIsAccessible(req, org)) throw "Клиент группы недоступен";
		seen.add(org);
		clients.push({ clientOrganizationUuid: org, responsibleUuid: c.responsibleUuid || null });
	}
	return { members, clients };
}

// ── Группы ────────────────────────────────────────────────────────────────────
router.get("/staff-groups", handler("GET /staff-groups", async (req, res) => {
	const ctx = await qualityContext(req);
	const q = listQuery(req, { textFields: ["name", "comment"], sortFields: ["id", "name"], defaultOrder: [{ name: "asc" }] });
	q.where.organizationUuid = ctx.firmOrgUuid;
	q.where.deletedAt = null;
	if (!ctx.firmOrgUuid || !orgIsAccessible(req, ctx.firmOrgUuid)) return res.json(listResponse([], q.take, 0));
	const [rows, total] = await Promise.all([
		prisma.staffGroup.findMany({ ...pageArgs(q), include: { members: true, clients: true } }),
		q.cursor ? undefined : prisma.staffGroup.count({ where: q.where }),
	]);
	res.json(listResponse(await Promise.all(rows.map(decorateGroup)), q.take, total));
}));

router.get("/staff-groups/:id", handler("GET /staff-groups/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const g = await prisma.staffGroup.findUnique({ where: byParam(req.params.id), include: { members: true, clients: true } });
	if (!g || g.deletedAt || g.organizationUuid !== ctx.firmOrgUuid || !orgIsAccessible(req, g.organizationUuid)) return fail(res, 404, "Группа не найдена");
	res.json({ success: true, item: { ...(await decorateGroup(g)), canEdit: canManage(ctx) } });
}));

async function saveGroup(req, res, existing) {
	const ctx = await qualityContext(req);
	if (!canManage(ctx)) return fail(res, 403, "Группы сотрудников настраивают администратор или руководитель");
	if (!ctx.firmOrgUuid) return fail(res, 400, "Не определена организация-фирма: назначьте её в настройках качества");
	const b = req.body || {};
	const name = text(b.name) || existing?.name || "";
	if (!name) return fail(res, 400, "Укажите название группы");
	let comp;
	try {
		comp = compositionOf(req, b);
	} catch (msg) {
		return fail(res, 403, String(msg));
	}
	const data = {
		name,
		headUuid: b.headUuid !== undefined ? b.headUuid || null : existing?.headUuid ?? null,
		managerUuid: b.managerUuid !== undefined ? b.managerUuid || null : existing?.managerUuid ?? null,
		comment: b.comment !== undefined ? text(b.comment) || null : existing?.comment ?? null,
	};
	if (data.headUuid && data.headUuid === data.managerUuid) return fail(res, 400, "Главбух и руководитель группы — разные люди: подтверждение нарушений идёт уровнем выше");
	const replaceMembers = Array.isArray(b.members);
	const replaceClients = Array.isArray(b.clients);
	const g = await prisma.$transaction(async (tx) => {
		const row = existing
			? await tx.staffGroup.update({ where: { uuid: existing.uuid }, data })
			: await tx.staffGroup.create({ data: { ...data, organizationUuid: ctx.firmOrgUuid } });
		if (replaceMembers) {
			await tx.staffGroupMember.deleteMany({ where: { groupUuid: row.uuid } });
			if (comp.members.length) await tx.staffGroupMember.createMany({ data: comp.members.map((userUuid) => ({ groupUuid: row.uuid, userUuid })) });
		}
		if (replaceClients) {
			await tx.staffGroupClient.deleteMany({ where: { groupUuid: row.uuid } });
			if (comp.clients.length) await tx.staffGroupClient.createMany({ data: comp.clients.map((c) => ({ groupUuid: row.uuid, ...c })) });
		}
		return tx.staffGroup.findUnique({ where: { uuid: row.uuid }, include: { members: true, clients: true } });
	});
	void recordAudit({ actionType: existing ? "update" : "create", objectType: "StaffGroup", objectId: g.uuid, objectName: g.name, organizationUuid: g.organizationUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, props: { members: comp.members.length, clients: comp.clients.length }, host: req.hostname, ip: req.ip });
	return res.status(existing ? 200 : 201).json({ success: true, item: await decorateGroup(g) });
}

router.post("/staff-groups", handler("POST /staff-groups", (req, res) => saveGroup(req, res, null)));

router.put("/staff-groups/:id", handler("PUT /staff-groups/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const g = await prisma.staffGroup.findUnique({ where: byParam(req.params.id) });
	if (!g || g.deletedAt || g.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Группа не найдена");
	return saveGroup(req, res, g);
}));

router.delete("/staff-groups/:id", handler("DELETE /staff-groups/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canManage(ctx)) return fail(res, 403, "Удаляют группу администратор или руководитель");
	const g = await prisma.staffGroup.findUnique({ where: byParam(req.params.id) });
	if (!g || g.deletedAt || g.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Группа не найдена");
	await prisma.staffGroup.update({ where: { uuid: g.uuid }, data: { deletedAt: new Date() } });
	void recordAudit({ actionType: "delete", objectType: "StaffGroup", objectId: g.uuid, objectName: g.name, organizationUuid: g.organizationUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, host: req.hostname, ip: req.ip });
	res.json({ success: true, message: "Удалено" });
}));

// ── Типовые ошибки ────────────────────────────────────────────────────────────
const canEditErrorTypes = (ctx) => canManage(ctx) || ctx.isHead;

router.get("/error-types", handler("GET /error-types", async (req, res) => {
	const ctx = await qualityContext(req);
	const q = listQuery(req, { textFields: ["name", "description"], sortFields: ["id", "name"], defaultOrder: [{ name: "asc" }] });
	q.where.organizationUuid = ctx.firmOrgUuid;
	q.where.deletedAt = null;
	if (!ctx.firmOrgUuid || !orgIsAccessible(req, ctx.firmOrgUuid)) return res.json(listResponse([], q.take, 0));
	const [rows, total] = await Promise.all([prisma.errorType.findMany(pageArgs(q)), q.cursor ? undefined : prisma.errorType.count({ where: q.where })]);
	res.json(listResponse(rows, q.take, total));
}));

router.get("/error-types/:id", handler("GET /error-types/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const e = await prisma.errorType.findUnique({ where: byParam(req.params.id) });
	if (!e || e.deletedAt || e.organizationUuid !== ctx.firmOrgUuid || !orgIsAccessible(req, e.organizationUuid)) return fail(res, 404, "Тип ошибки не найден");
	res.json({ success: true, item: e });
}));

router.post("/error-types", handler("POST /error-types", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canEditErrorTypes(ctx)) return fail(res, 403, "Справочник ошибок ведут главбух, руководитель или администратор");
	const name = text(req.body?.name);
	if (!name) return fail(res, 400, "Укажите название типа ошибки");
	const e = await prisma.errorType.create({ data: { organizationUuid: ctx.firmOrgUuid, name, description: text(req.body?.description) || null } });
	res.status(201).json({ success: true, item: e });
}));

router.put("/error-types/:id", handler("PUT /error-types/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canEditErrorTypes(ctx)) return fail(res, 403, "Справочник ошибок ведут главбух, руководитель или администратор");
	const e = await prisma.errorType.findUnique({ where: byParam(req.params.id) });
	if (!e || e.deletedAt || e.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Тип ошибки не найден");
	const data = {};
	if (req.body?.name !== undefined) data.name = text(req.body.name) || e.name;
	if (req.body?.description !== undefined) data.description = text(req.body.description) || null;
	res.json({ success: true, item: await prisma.errorType.update({ where: { uuid: e.uuid }, data }) });
}));

router.delete("/error-types/:id", handler("DELETE /error-types/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canEditErrorTypes(ctx)) return fail(res, 403, "Справочник ошибок ведут главбух, руководитель или администратор");
	const e = await prisma.errorType.findUnique({ where: byParam(req.params.id) });
	if (!e || e.deletedAt || e.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Тип ошибки не найден");
	await prisma.errorType.update({ where: { uuid: e.uuid }, data: { deletedAt: new Date() } });
	res.json({ success: true, message: "Удалено" });
}));

export default router;
