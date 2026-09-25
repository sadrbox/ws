// ─────────────────────────────────────────────────────────────────────────────
// E17 СК3 — чек-листы самопроверки (пп. 26–28).
//
//   GET|POST /checklist-templates, GET|PUT|DELETE /checklist-templates/:id
//     Шаблон и пункты (items[] заменяются целиком). Пункт может ссылаться на код проверки
//     учёта (checkCode) — тогда «ок» при открытых находках не принимается.
//   GET|POST /checklist-runs, GET|DELETE /checklist-runs/:id
//     Прогон по клиенту за период: исполнитель отмечает, главбух подписывает.
//   POST /checklist-runs/:id/items/:itemId   отметить пункт {status, comment}
//   POST /checklist-runs/:id/submit          сдать главбуху
//   POST /checklist-runs/:id/review          подписать (установленный контроль главбуха, п. 28)
//
// Шаблоны — фирмы (orgIsAccessible), прогоны — по клиентам, доступным пользователю.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { orgIsAccessible } from "../../utils/auth.js";
import { qualityContext, canManage, canSee, userNames, orgNames, groupOfClient, responsibleForClient } from "../../services/quality/access.js";
import { createRunFromTemplate, markItem, submitRun, reviewRun } from "../../services/quality/checklists.js";
import { checkTitle } from "../../services/quality/findingRules.js";
import { listQuery, pageArgs, listResponse, fail, handler, bodyDate, text } from "../../services/quality/http.js";

const router = express.Router();

const byParam = (id) => {
	const n = Number(id);
	return Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(id) };
};
const canEditTemplates = (ctx) => canManage(ctx) || ctx.isHead;

// ── Шаблоны ───────────────────────────────────────────────────────────────────
router.get("/checklist-templates", handler("GET /checklist-templates", async (req, res) => {
	const ctx = await qualityContext(req);
	const q = listQuery(req, { textFields: ["name", "description"], filterFields: ["isActive", "periodicity"], sortFields: ["id", "name"], defaultOrder: [{ name: "asc" }] });
	q.where.organizationUuid = ctx.firmOrgUuid;
	q.where.deletedAt = null;
	if (!ctx.firmOrgUuid || !orgIsAccessible(req, ctx.firmOrgUuid)) return res.json(listResponse([], q.take, 0));
	const [rows, total] = await Promise.all([
		prisma.checklistTemplate.findMany({ ...pageArgs(q), include: { items: { orderBy: { position: "asc" } } } }),
		q.cursor ? undefined : prisma.checklistTemplate.count({ where: q.where }),
	]);
	res.json(listResponse(rows.map((t) => ({ ...t, itemsCount: t.items.length })), q.take, total));
}));

router.get("/checklist-templates/:id", handler("GET /checklist-templates/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const t = await prisma.checklistTemplate.findUnique({ where: byParam(req.params.id), include: { items: { orderBy: { position: "asc" } } } });
	if (!t || t.deletedAt || t.organizationUuid !== ctx.firmOrgUuid || !orgIsAccessible(req, t.organizationUuid)) return fail(res, 404, "Шаблон не найден");
	res.json({ success: true, item: { ...t, items: t.items.map((i) => ({ ...i, checkTitle: i.checkCode ? checkTitle(i.checkCode) : null })), canEdit: canEditTemplates(ctx) } });
}));

async function saveTemplate(req, res, existing) {
	const ctx = await qualityContext(req);
	if (!canEditTemplates(ctx)) return fail(res, 403, "Шаблоны чек-листов ведут главбух, руководитель или администратор");
	if (!ctx.firmOrgUuid) return fail(res, 400, "Не определена организация-фирма");
	const b = req.body || {};
	const name = text(b.name) || existing?.name || "";
	if (!name) return fail(res, 400, "Укажите название чек-листа");
	const items = Array.isArray(b.items)
		? b.items.map((i, idx) => ({ position: Number.isFinite(Number(i.position)) ? Number(i.position) : idx, text: text(i.text), checkCode: text(i.checkCode) || null, standardItemNumber: Number(i.standardItemNumber) || null })).filter((i) => i.text)
		: null;
	const data = {
		name,
		description: b.description !== undefined ? text(b.description) || null : existing?.description ?? null,
		periodicity: ["month", "quarter", "year", "once"].includes(b.periodicity) ? b.periodicity : existing?.periodicity ?? "month",
		isActive: b.isActive !== undefined ? !!b.isActive : existing?.isActive ?? true,
	};
	const t = await prisma.$transaction(async (tx) => {
		const row = existing ? await tx.checklistTemplate.update({ where: { uuid: existing.uuid }, data }) : await tx.checklistTemplate.create({ data: { ...data, organizationUuid: ctx.firmOrgUuid } });
		if (items) {
			await tx.checklistTemplateItem.deleteMany({ where: { templateUuid: row.uuid } });
			if (items.length) await tx.checklistTemplateItem.createMany({ data: items.map((i) => ({ ...i, templateUuid: row.uuid })) });
		}
		return tx.checklistTemplate.findUnique({ where: { uuid: row.uuid }, include: { items: { orderBy: { position: "asc" } } } });
	});
	return res.status(existing ? 200 : 201).json({ success: true, item: t });
}

router.post("/checklist-templates", handler("POST /checklist-templates", (req, res) => saveTemplate(req, res, null)));
router.put("/checklist-templates/:id", handler("PUT /checklist-templates/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const t = await prisma.checklistTemplate.findUnique({ where: byParam(req.params.id) });
	if (!t || t.deletedAt || t.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Шаблон не найден");
	return saveTemplate(req, res, t);
}));
router.delete("/checklist-templates/:id", handler("DELETE /checklist-templates/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canEditTemplates(ctx)) return fail(res, 403, "Шаблоны чек-листов ведут главбух, руководитель или администратор");
	const t = await prisma.checklistTemplate.findUnique({ where: byParam(req.params.id) });
	if (!t || t.deletedAt || t.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Шаблон не найден");
	await prisma.checklistTemplate.update({ where: { uuid: t.uuid }, data: { deletedAt: new Date() } });
	res.json({ success: true, message: "Удалено" });
}));

// ── Прогоны ───────────────────────────────────────────────────────────────────

/** Прогон, доступный пользователю: клиент доступен и пользователь — участник или контролёр. */
async function findRun(req, ctx, id) {
	const r = await prisma.checklistRun.findUnique({ where: byParam(id), include: { items: { orderBy: { position: "asc" } } } });
	if (!r || r.deletedAt || !orgIsAccessible(req, r.clientOrganizationUuid)) return null;
	const involved = r.executorUuid === ctx.userUuid || r.reviewerUuid === ctx.userUuid;
	// Видят: исполнитель и главбух прогона, админ, те, кто ведёт/контролирует клиента, и те,
	// кому виден исполнитель (главбух и руководитель его группы).
	if (!involved && !ctx.isAdmin && !ctx.clientOrgUuids.has(r.clientOrganizationUuid) && !(r.executorUuid && canSee(ctx, r.executorUuid))) return null;
	return r;
}

async function decorateRuns(rows) {
	const names = await userNames(rows.flatMap((r) => [r.executorUuid, r.reviewerUuid, ...(r.items || []).map((i) => i.confirmedByUuid)]));
	const orgs = await orgNames(rows.map((r) => r.clientOrganizationUuid));
	return rows.map((r) => ({
		...r,
		clientName: orgs.get(r.clientOrganizationUuid) ?? null,
		executorName: names.get(r.executorUuid) ?? null,
		reviewerName: names.get(r.reviewerUuid) ?? null,
		progress: r.items ? { total: r.items.length, done: r.items.filter((i) => i.status !== "pending").length, problems: r.items.filter((i) => i.status === "problem").length } : undefined,
		items: r.items?.map((i) => ({ ...i, confirmedByName: names.get(i.confirmedByUuid) ?? null, checkTitle: i.checkCode ? checkTitle(i.checkCode) : null })),
	}));
}

router.get("/checklist-runs", handler("GET /checklist-runs", async (req, res) => {
	const ctx = await qualityContext(req);
	const q = listQuery(req, { textFields: ["name"], filterFields: ["status", "clientOrganizationUuid", "executorUuid", "reviewerUuid"], sortFields: ["id", "periodFrom", "status", "createdAt"], defaultOrder: [{ periodFrom: "desc" }] });
	q.where.deletedAt = null;
	const allowed = req.user?.isSuperAdmin ? null : [req.user?.organizationUuid, ...(req.user?.allowedOrgUuids || [])].filter(Boolean);
	if (allowed) q.where.clientOrganizationUuid = { in: allowed };
	if (!ctx.isAdmin) {
		q.where.OR = [
			{ executorUuid: ctx.userUuid },
			{ reviewerUuid: ctx.userUuid },
			...(ctx.clientOrgUuids.size ? [{ clientOrganizationUuid: { in: [...ctx.clientOrgUuids] } }] : []),
		];
	}
	const [rows, total] = await Promise.all([
		prisma.checklistRun.findMany({ ...pageArgs(q), include: { items: true } }),
		q.cursor ? undefined : prisma.checklistRun.count({ where: q.where }),
	]);
	res.json(listResponse((await decorateRuns(rows)).map((r) => ({ ...r, items: undefined })), q.take, total));
}));

router.get("/checklist-runs/:id", handler("GET /checklist-runs/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const r = await findRun(req, ctx, req.params.id);
	if (!r) return fail(res, 404, "Чек-лист не найден");
	const [out] = await decorateRuns([r]);
	res.json({ success: true, item: { ...out, canMark: r.executorUuid === ctx.userUuid || ctx.isAdmin, canReview: r.status === "submitted" && (r.reviewerUuid === ctx.userUuid || ctx.isAdmin || (ctx.isHead && ctx.clientOrgUuids.has(r.clientOrganizationUuid))) } });
}));

router.post("/checklist-runs", handler("POST /checklist-runs", async (req, res) => {
	const ctx = await qualityContext(req);
	const b = req.body || {};
	const client = text(b.clientOrganizationUuid);
	if (!client || !orgIsAccessible(req, client)) return fail(res, 403, "Клиент недоступен");
	const template = await prisma.checklistTemplate.findUnique({ where: { uuid: text(b.templateUuid) }, include: { items: true } });
	if (!template || template.deletedAt || template.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Шаблон не найден");
	const periodFrom = bodyDate(b.periodFrom, "дата начала периода");
	const periodTo = bodyDate(b.periodTo, "дата конца периода");
	if (!periodFrom || !periodTo || periodFrom > periodTo) return fail(res, 400, "Укажите период: начало не позже конца");
	const executorUuid = b.executorUuid || (await responsibleForClient(client)) || ctx.userUuid;
	const reviewerUuid = b.reviewerUuid || (await groupOfClient(client))?.headUuid || null;
	const run = await createRunFromTemplate({ template, clientOrganizationUuid: client, periodFrom, periodTo, executorUuid, reviewerUuid, firmOrgUuid: ctx.firmOrgUuid });
	const [out] = await decorateRuns([run]);
	res.status(201).json({ success: true, item: out });
}));

router.post("/checklist-runs/:id/items/:itemId", handler("POST /checklist-runs/:id/items/:itemId", async (req, res) => {
	const ctx = await qualityContext(req);
	const run = await findRun(req, ctx, req.params.id);
	if (!run) return fail(res, 404, "Чек-лист не найден");
	if (!(run.executorUuid === ctx.userUuid || ctx.isAdmin)) return fail(res, 403, "Отмечает пункты исполнитель чек-листа");
	const item = run.items.find((i) => i.uuid === req.params.itemId || String(i.id) === req.params.itemId);
	if (!item) return fail(res, 404, "Пункт не найден");
	const r = await markItem({ run, item, status: req.body?.status, comment: req.body?.comment, userUuid: ctx.userUuid });
	if (r.error) return fail(res, 400, r.error);
	res.json({ success: true, item: r.item });
}));

router.post("/checklist-runs/:id/submit", handler("POST /checklist-runs/:id/submit", async (req, res) => {
	const ctx = await qualityContext(req);
	const run = await findRun(req, ctx, req.params.id);
	if (!run) return fail(res, 404, "Чек-лист не найден");
	if (!(run.executorUuid === ctx.userUuid || ctx.isAdmin)) return fail(res, 403, "Сдаёт чек-лист исполнитель");
	const r = await submitRun(run);
	if (r.error) return fail(res, 400, r.error);
	res.json({ success: true, item: r.run });
}));

router.post("/checklist-runs/:id/review", handler("POST /checklist-runs/:id/review", async (req, res) => {
	const ctx = await qualityContext(req);
	const run = await findRun(req, ctx, req.params.id);
	if (!run) return fail(res, 404, "Чек-лист не найден");
	const may = run.reviewerUuid === ctx.userUuid || ctx.isAdmin || (ctx.isHead && ctx.clientOrgUuids.has(run.clientOrganizationUuid));
	if (!may || run.executorUuid === ctx.userUuid) return fail(res, 403, "Подписывает главбух — не исполнитель");
	const r = await reviewRun(run, ctx.userUuid);
	if (r.error) return fail(res, 400, r.error);
	res.json({ success: true, item: r.run });
}));

router.delete("/checklist-runs/:id", handler("DELETE /checklist-runs/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const run = await findRun(req, ctx, req.params.id);
	if (!run) return fail(res, 404, "Чек-лист не найден");
	if (run.status === "reviewed" && !ctx.isAdmin) return fail(res, 409, "Подписанный чек-лист удаляет только администратор");
	if (!(ctx.isAdmin || ctx.isHead || run.executorUuid === ctx.userUuid)) return fail(res, 403, "Удаляет исполнитель, главбух или администратор");
	await prisma.checklistRun.update({ where: { uuid: run.uuid }, data: { deletedAt: new Date() } });
	res.json({ success: true, message: "Удалено" });
}));

export default router;
