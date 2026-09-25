// ─────────────────────────────────────────────────────────────────────────────
// E17 СК5 — реестр нарушений стандарта, меры руководителя, справочник пунктов.
//
//   GET    /standard-violations                  список (видимые сотрудники)
//   GET    /standard-violations/:id
//   POST   /standard-violations                  завести вручную (кто решает по сотруднику)
//   PUT    /standard-violations/:id              поправить кандидата/нарушение
//   POST   /standard-violations/:id/confirm      подтвердить (можно отметить «самовыявлено»)
//   POST   /standard-violations/:id/reject       отклонить (причина обязательна)
//   POST   /standard-violations/:id/dispute      возражение нарушителя
//   POST   /standard-violations/:id/resolve-dispute  решение по возражению (уровнем выше)
//   DELETE /standard-violations/:id              удалить ошибочную запись (админ)
//   GET|POST|DELETE /violation-measures          меры руководителя (п. 30)
//   GET|PUT /standard-items, POST /standard-items/seed   справочник пунктов
//
// Каждое нарушение — конкретный факт: дата, сотрудник, клиент/участок, суть и пункт стандарта
// (правила применения бонуса) — без них запись не создаётся. Месяц бонуса — месяц выявления;
// в закрытом месяце записи не меняются. Права — по группам (services/quality/access.js);
// организация-фирма — orgIsAccessible.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { orgIsAccessible } from "../../utils/auth.js";
import { recordAudit } from "../../services/auditLog.js";
import { qualityContext, canSee, canDecide, canManage, userNames, orgNames } from "../../services/quality/access.js";
import { getQualitySettings } from "../../services/quality/settings.js";
import { ensureStandardItems, closedMonths } from "../../services/quality/violations.js";
import { MEASURE_KINDS } from "../../services/quality/bonusRules.js";
import { monthOf } from "../../services/quality/time.js";
import { notifyUser } from "../../services/quality/notify.js";
import { listQuery, pageArgs, listResponse, fail, handler, bodyDate, text } from "../../services/quality/http.js";

const router = express.Router();

const audit = (req, actionType, v, props = null) =>
	void recordAudit({ actionType, objectType: "StandardViolation", objectId: v.uuid, objectName: `Нарушение п. ${v.itemNumber}`, organizationUuid: v.organizationUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, props, host: req.hostname, ip: req.ip });

/** Нарушение фирмы, видимое пользователю; иначе null («не найдено»). */
async function findVisible(req, ctx, id) {
	const numId = Number(id);
	const v = await prisma.standardViolation.findUnique({ where: Number.isInteger(numId) && numId > 0 ? { id: numId } : { uuid: String(id) } });
	if (!v || v.deletedAt) return null;
	if (v.organizationUuid && !orgIsAccessible(req, v.organizationUuid) && !ctx.isSuperAdmin) return null;
	if (v.organizationUuid !== ctx.firmOrgUuid && !ctx.isSuperAdmin) return null;
	if (!canSee(ctx, v.userUuid)) return null;
	return v;
}

/** Имена и подписи для списка/формы. */
async function decorate(rows, firmOrgUuid) {
	const [names, orgs, items] = await Promise.all([
		userNames(rows.flatMap((v) => [v.userUuid, v.createdByUuid, v.decidedByUuid, v.disputeDecidedByUuid])),
		orgNames(rows.map((v) => v.clientOrganizationUuid)),
		prisma.standardItem.findMany({ where: { organizationUuid: firmOrgUuid }, select: { number: true, title: true } }),
	]);
	const titles = new Map(items.map((i) => [i.number, i.title]));
	return rows.map((v) => ({
		...v,
		userName: names.get(v.userUuid) ?? null,
		createdByName: names.get(v.createdByUuid) ?? null,
		decidedByName: names.get(v.decidedByUuid) ?? null,
		disputeDecidedByName: names.get(v.disputeDecidedByUuid) ?? null,
		clientName: orgs.get(v.clientOrganizationUuid) ?? null,
		itemTitle: titles.get(v.itemNumber) ?? null,
	}));
}

async function assertMonthOpen(v) {
	const closed = await closedMonths(v.organizationUuid);
	return closed.has(v.bonusMonth) ? `Месяц бонусов ${v.bonusMonth} закрыт — запись не меняется` : null;
}

// ── Список ────────────────────────────────────────────────────────────────────
router.get("/standard-violations", handler("GET /standard-violations", async (req, res) => {
	const ctx = await qualityContext(req);
	const q = listQuery(req, {
		textFields: ["description", "decisionNote", "disputeText"],
		filterFields: ["status", "bonusMonth", "userUuid", "itemNumber", "clientOrganizationUuid", "source", "selfDetected"],
		numericFields: ["itemNumber"],
		sortFields: ["id", "detectedAt", "occurredAt", "itemNumber", "status", "bonusMonth"],
		defaultOrder: [{ detectedAt: "desc" }],
	});
	q.where.organizationUuid = ctx.firmOrgUuid;
	q.where.deletedAt = null;
	if (ctx.visible) q.where.userUuid = { in: [...ctx.visible] };
	if (req.query.mine === "1") q.where.userUuid = ctx.userUuid;
	if (req.query.toDecide === "1") {
		q.where.status = { in: ["candidate", "disputed"] };
		if (ctx.decidable) q.where.userUuid = { in: [...ctx.decidable] };
	}
	if (ctx.firmOrgUuid && !orgIsAccessible(req, ctx.firmOrgUuid)) return res.json(listResponse([], q.take, 0));
	const [rows, total] = await Promise.all([
		prisma.standardViolation.findMany(pageArgs(q)),
		q.cursor ? undefined : prisma.standardViolation.count({ where: q.where }),
	]);
	res.json(listResponse(await decorate(rows, ctx.firmOrgUuid), q.take, total));
}));

router.get("/standard-violations/:id", handler("GET /standard-violations/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const v = await findVisible(req, ctx, req.params.id);
	if (!v) return fail(res, 404, "Запись не найдена");
	const [item] = await decorate([v], ctx.firmOrgUuid);
	res.json({ success: true, item: { ...item, canDecide: canDecide(ctx, v.userUuid), isMine: v.userUuid === ctx.userUuid } });
}));

// ── Создание вручную ─────────────────────────────────────────────────────────
router.post("/standard-violations", handler("POST /standard-violations", async (req, res) => {
	const ctx = await qualityContext(req);
	const b = req.body || {};
	const userUuid = text(b.userUuid);
	const itemNumber = Number(b.itemNumber);
	const description = text(b.description);
	const area = text(b.area);
	const occurredAt = bodyDate(b.occurredAt, "дата факта");
	const errors = [];
	if (!userUuid) errors.push("сотрудник");
	if (!Number.isInteger(itemNumber) || itemNumber < 1) errors.push("пункт стандарта");
	if (!occurredAt) errors.push("дата факта");
	if (!b.clientOrganizationUuid && !area) errors.push("клиент или участок");
	if (description.length < 10) errors.push("суть нарушения (не короче 10 знаков)");
	if (errors.length) return fail(res, 400, `Нарушение подтверждается конкретным фактом — заполните: ${errors.join(", ")}`);
	if (!ctx.firmOrgUuid) return fail(res, 400, "Не определена организация-фирма");
	if (!canDecide(ctx, userUuid)) return fail(res, 403, "Заводить нарушение сотрудника может его главбух, руководитель или администратор");
	if (b.clientOrganizationUuid && !orgIsAccessible(req, b.clientOrganizationUuid)) return fail(res, 403, "Клиент недоступен");
	if (occurredAt > new Date()) return fail(res, 400, "Дата факта не может быть в будущем");
	await ensureStandardItems(ctx.firmOrgUuid);
	const item = await prisma.standardItem.findFirst({ where: { organizationUuid: ctx.firmOrgUuid, number: itemNumber, deletedAt: null } });
	if (!item) return fail(res, 400, `Пункта ${itemNumber} нет в справочнике стандарта`);
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const now = new Date();
	const bonusMonth = monthOf(now, settings.tzOffsetMinutes);
	if ((await closedMonths(ctx.firmOrgUuid)).has(bonusMonth)) return fail(res, 409, `Месяц бонусов ${bonusMonth} уже закрыт`);
	const status = b.status === "candidate" ? "candidate" : "confirmed";
	const evidence = Array.isArray(b.evidence) ? b.evidence.slice(0, 20) : [];
	if (area) evidence.push({ kind: "area", label: area });
	const v = await prisma.standardViolation.create({
		data: {
			organizationUuid: ctx.firmOrgUuid, userUuid, clientOrganizationUuid: b.clientOrganizationUuid || null,
			standardItemUuid: item.uuid, itemNumber, occurredAt, detectedAt: now, bonusMonth, description,
			evidence, source: "manual", status, createdByUuid: ctx.userUuid,
			...(status === "confirmed" ? { decidedByUuid: ctx.userUuid, decidedAt: now } : {}),
		},
	});
	audit(req, "create", v, { status });
	await notifyUser(userUuid, {
		kind: "violation", title: status === "confirmed" ? `Зафиксировано нарушение: п. ${itemNumber} «${item.title}»` : `Кандидат в нарушения: п. ${itemNumber}`,
		body: description, link: { endpoint: "standard-violations", uuid: v.uuid }, organizationUuid: ctx.firmOrgUuid, dedupKey: `violation-own:${v.uuid}`,
	});
	const [out] = await decorate([v], ctx.firmOrgUuid);
	res.status(201).json({ success: true, item: out });
}));

// ── Правка ────────────────────────────────────────────────────────────────────
router.put("/standard-violations/:id", handler("PUT /standard-violations/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const v = await findVisible(req, ctx, req.params.id);
	if (!v) return fail(res, 404, "Запись не найдена");
	if (!canDecide(ctx, v.userUuid)) return fail(res, 403, "Править может тот, кто решает по сотруднику");
	if (v.status === "rejected") return fail(res, 409, "Отклонённую запись не правят — заведите новую");
	const locked = await assertMonthOpen(v);
	if (locked) return fail(res, 409, locked);
	const b = req.body || {};
	const data = {};
	if (b.description !== undefined) {
		if (text(b.description).length < 10) return fail(res, 400, "Суть нарушения — не короче 10 знаков");
		data.description = text(b.description);
	}
	if (b.itemNumber !== undefined) {
		const n = Number(b.itemNumber);
		const item = await prisma.standardItem.findFirst({ where: { organizationUuid: v.organizationUuid, number: n, deletedAt: null } });
		if (!item) return fail(res, 400, `Пункта ${n} нет в справочнике стандарта`);
		data.itemNumber = n;
		data.standardItemUuid = item.uuid;
	}
	if (b.occurredAt !== undefined) data.occurredAt = bodyDate(b.occurredAt, "дата факта") ?? v.occurredAt;
	if (b.clientOrganizationUuid !== undefined) {
		if (b.clientOrganizationUuid && !orgIsAccessible(req, b.clientOrganizationUuid)) return fail(res, 403, "Клиент недоступен");
		data.clientOrganizationUuid = b.clientOrganizationUuid || null;
	}
	if (Array.isArray(b.evidence)) data.evidence = b.evidence.slice(0, 30);
	const updated = await prisma.standardViolation.update({ where: { uuid: v.uuid }, data });
	audit(req, "update", updated, { fields: Object.keys(data) });
	const [out] = await decorate([updated], ctx.firmOrgUuid);
	res.json({ success: true, item: out });
}));

// ── Решения ───────────────────────────────────────────────────────────────────
router.post("/standard-violations/:id/confirm", handler("POST /standard-violations/:id/confirm", async (req, res) => {
	const ctx = await qualityContext(req);
	const v = await findVisible(req, ctx, req.params.id);
	if (!v) return fail(res, 404, "Запись не найдена");
	if (!canDecide(ctx, v.userUuid)) return fail(res, 403, "Подтверждает главбух, руководитель или администратор — не сам сотрудник");
	if (v.status !== "candidate") return fail(res, 409, "Подтвердить можно только кандидата");
	const locked = await assertMonthOpen(v);
	if (locked) return fail(res, 409, locked);
	const selfDetected = !!req.body?.selfDetected;
	const info = req.body?.selfDetectedInfo && typeof req.body.selfDetectedInfo === "object" ? req.body.selfDetectedInfo : null;
	// Самовыявленная ошибка — не нарушение только при всех условиях правил применения.
	if (selfDetected && !(info?.foundBySelfCheck && info?.fixedInTime && info?.noConsequences)) {
		return fail(res, 400, "«Самовыявлено» — только если ошибка найдена при самопроверке, своевременно исправлена и не повлекла последствий (правила применения бонуса)");
	}
	const updated = await prisma.standardViolation.update({
		where: { uuid: v.uuid },
		data: { status: "confirmed", decidedByUuid: ctx.userUuid, decidedAt: new Date(), decisionNote: text(req.body?.note) || null, selfDetected, selfDetectedInfo: info ?? undefined },
	});
	audit(req, "confirm", updated, { selfDetected });
	await notifyUser(v.userUuid, {
		kind: "violation", title: selfDetected ? `Самовыявленная ошибка учтена (не нарушение): п. ${v.itemNumber}` : `Подтверждено нарушение: п. ${v.itemNumber}`,
		body: v.description, link: { endpoint: "standard-violations", uuid: v.uuid }, organizationUuid: v.organizationUuid, dedupKey: `violation-confirmed:${v.uuid}`,
	});
	const [out] = await decorate([updated], ctx.firmOrgUuid);
	res.json({ success: true, item: out });
}));

router.post("/standard-violations/:id/reject", handler("POST /standard-violations/:id/reject", async (req, res) => {
	const ctx = await qualityContext(req);
	const v = await findVisible(req, ctx, req.params.id);
	if (!v) return fail(res, 404, "Запись не найдена");
	if (!canDecide(ctx, v.userUuid)) return fail(res, 403, "Отклоняет главбух, руководитель или администратор");
	if (!["candidate", "confirmed"].includes(v.status)) return fail(res, 409, "Отклонить можно кандидата или подтверждённую запись");
	const note = text(req.body?.note);
	if (note.length < 5) return fail(res, 400, "Укажите причину отклонения");
	const locked = await assertMonthOpen(v);
	if (locked) return fail(res, 409, locked);
	const updated = await prisma.standardViolation.update({ where: { uuid: v.uuid }, data: { status: "rejected", decidedByUuid: ctx.userUuid, decidedAt: new Date(), decisionNote: note } });
	audit(req, "reject", updated, { note });
	const [out] = await decorate([updated], ctx.firmOrgUuid);
	res.json({ success: true, item: out });
}));

router.post("/standard-violations/:id/dispute", handler("POST /standard-violations/:id/dispute", async (req, res) => {
	const ctx = await qualityContext(req);
	const v = await findVisible(req, ctx, req.params.id);
	if (!v) return fail(res, 404, "Запись не найдена");
	if (v.userUuid !== ctx.userUuid) return fail(res, 403, "Оспорить может только сам сотрудник");
	if (v.status !== "confirmed") return fail(res, 409, "Оспорить можно подтверждённое нарушение");
	const t = text(req.body?.text);
	if (t.length < 10) return fail(res, 400, "Опишите возражение (не короче 10 знаков)");
	const locked = await assertMonthOpen(v);
	if (locked) return fail(res, 409, locked);
	const updated = await prisma.standardViolation.update({ where: { uuid: v.uuid }, data: { status: "disputed", disputeText: t, disputedAt: new Date() } });
	audit(req, "dispute", updated);
	const [out] = await decorate([updated], ctx.firmOrgUuid);
	res.json({ success: true, item: out });
}));

router.post("/standard-violations/:id/resolve-dispute", handler("POST /standard-violations/:id/resolve-dispute", async (req, res) => {
	const ctx = await qualityContext(req);
	const v = await findVisible(req, ctx, req.params.id);
	if (!v) return fail(res, 404, "Запись не найдена");
	if (v.status !== "disputed") return fail(res, 409, "Возражения по записи нет");
	if (!canDecide(ctx, v.userUuid)) return fail(res, 403, "Решает главбух, руководитель или администратор");
	// «Решает следующий уровень»: не тот, кто подтверждал (кроме администратора). В маленькой фирме уровня
	// выше может не быть — тогда решает администратор фирмы (решено 25.09).
	if (v.decidedByUuid === ctx.userUuid && !ctx.isAdmin) return fail(res, 403, "По возражению решает не тот, кто подтверждал нарушение, а уровень выше");
	const decision = req.body?.decision === "rejected" ? "rejected" : req.body?.decision === "confirmed" ? "confirmed" : null;
	if (!decision) return fail(res, 400, "Решение: confirmed или rejected");
	const note = text(req.body?.note);
	if (note.length < 5) return fail(res, 400, "Обоснуйте решение по возражению");
	const locked = await assertMonthOpen(v);
	if (locked) return fail(res, 409, locked);
	const updated = await prisma.standardViolation.update({
		where: { uuid: v.uuid },
		data: { status: decision, disputeDecidedByUuid: ctx.userUuid, disputeDecidedAt: new Date(), disputeDecision: note },
	});
	audit(req, "resolve_dispute", updated, { decision });
	await notifyUser(v.userUuid, { kind: "violation", title: decision === "rejected" ? `Возражение принято: п. ${v.itemNumber} снят` : `Возражение отклонено: п. ${v.itemNumber}`, body: note, link: { endpoint: "standard-violations", uuid: v.uuid }, organizationUuid: v.organizationUuid, dedupKey: `dispute:${v.uuid}` });
	const [out] = await decorate([updated], ctx.firmOrgUuid);
	res.json({ success: true, item: out });
}));

router.delete("/standard-violations/:id", handler("DELETE /standard-violations/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const v = await findVisible(req, ctx, req.params.id);
	if (!v) return fail(res, 404, "Запись не найдена");
	if (!ctx.isAdmin) return fail(res, 403, "Удаляет только администратор; обычный путь — отклонить с причиной");
	const locked = await assertMonthOpen(v);
	if (locked) return fail(res, 409, locked);
	await prisma.standardViolation.update({ where: { uuid: v.uuid }, data: { deletedAt: new Date() } });
	audit(req, "delete", v);
	res.json({ success: true, message: "Удалено" });
}));

// ── Меры руководителя (п. 30) ────────────────────────────────────────────────
router.get("/violation-measures", handler("GET /violation-measures", async (req, res) => {
	const ctx = await qualityContext(req);
	const q = listQuery(req, { textFields: ["note"], filterFields: ["userUuid", "kind", "violationUuid"], sortFields: ["id", "date"], defaultOrder: [{ date: "desc" }] });
	q.where.organizationUuid = ctx.firmOrgUuid;
	q.where.deletedAt = null;
	if (ctx.visible) q.where.userUuid = { in: [...ctx.visible] };
	if (ctx.firmOrgUuid && !orgIsAccessible(req, ctx.firmOrgUuid)) return res.json(listResponse([], q.take, 0));
	const [rows, total] = await Promise.all([prisma.violationMeasure.findMany(pageArgs(q)), q.cursor ? undefined : prisma.violationMeasure.count({ where: q.where })]);
	const names = await userNames(rows.flatMap((m) => [m.userUuid, m.createdByUuid]));
	res.json(listResponse(rows.map((m) => ({ ...m, userName: names.get(m.userUuid) ?? null, createdByName: names.get(m.createdByUuid) ?? null })), q.take, total));
}));

router.post("/violation-measures", handler("POST /violation-measures", async (req, res) => {
	const ctx = await qualityContext(req);
	const b = req.body || {};
	const userUuid = text(b.userUuid);
	if (!userUuid) return fail(res, 400, "Укажите сотрудника");
	if (!canDecide(ctx, userUuid)) return fail(res, 403, "Меру назначает главбух, руководитель или администратор");
	const kind = MEASURE_KINDS.includes(b.kind) ? b.kind : "talk";
	const note = text(b.note);
	if (note.length < 5) return fail(res, 400, "Опишите меру");
	const m = await prisma.violationMeasure.create({
		data: { organizationUuid: ctx.firmOrgUuid, userUuid, violationUuid: b.violationUuid || null, kind, date: bodyDate(b.date, "дата меры") || new Date(), note, createdByUuid: ctx.userUuid },
	});
	void recordAudit({ actionType: "create", objectType: "ViolationMeasure", objectId: m.uuid, objectName: "Мера руководителя", organizationUuid: ctx.firmOrgUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, host: req.hostname, ip: req.ip });
	res.status(201).json({ success: true, item: m });
}));

router.delete("/violation-measures/:id", handler("DELETE /violation-measures/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const m = await prisma.violationMeasure.findUnique({ where: { uuid: String(req.params.id) } });
	if (!m || m.deletedAt || m.organizationUuid !== ctx.firmOrgUuid || !canSee(ctx, m.userUuid)) return fail(res, 404, "Запись не найдена");
	if (!(ctx.isAdmin || m.createdByUuid === ctx.userUuid)) return fail(res, 403, "Удалить меру может её автор или администратор");
	await prisma.violationMeasure.update({ where: { uuid: m.uuid }, data: { deletedAt: new Date() } });
	res.json({ success: true, message: "Удалено" });
}));

// ── Справочник пунктов стандарта ─────────────────────────────────────────────
router.get("/standard-items", handler("GET /standard-items", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!ctx.firmOrgUuid || !orgIsAccessible(req, ctx.firmOrgUuid)) return res.json({ success: true, items: [], total: 0 });
	await ensureStandardItems(ctx.firmOrgUuid);
	const items = await prisma.standardItem.findMany({ where: { organizationUuid: ctx.firmOrgUuid, deletedAt: null }, orderBy: { number: "asc" } });
	res.json({ success: true, items, total: items.length, hasMore: false, nextCursor: null });
}));

router.get("/standard-items/:id", handler("GET /standard-items/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	const numId = Number(req.params.id);
	const item = await prisma.standardItem.findUnique({ where: Number.isInteger(numId) && numId > 0 ? { id: numId } : { uuid: String(req.params.id) } });
	if (!item || item.organizationUuid !== ctx.firmOrgUuid || !orgIsAccessible(req, item.organizationUuid)) return fail(res, 404, "Пункт не найден");
	res.json({ success: true, item });
}));

router.put("/standard-items/:id", handler("PUT /standard-items/:id", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canManage(ctx)) return fail(res, 403, "Справочник стандарта правят администратор или руководитель");
	const numId = Number(req.params.id);
	const item = await prisma.standardItem.findUnique({ where: Number.isInteger(numId) && numId > 0 ? { id: numId } : { uuid: String(req.params.id) } });
	if (!item || item.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Пункт не найден");
	const b = req.body || {};
	const data = {};
	if (b.title !== undefined) data.title = text(b.title) || item.title;
	if (b.text !== undefined) data.text = text(b.text) || item.text;
	if (b.isActive !== undefined) data.isActive = !!b.isActive;
	if (["employee", "chief", "manager"].includes(b.appliesTo)) data.appliesTo = b.appliesTo;
	if (["auto", "signal", "manual"].includes(b.kind)) data.kind = b.kind;
	const updated = await prisma.standardItem.update({ where: { uuid: item.uuid }, data });
	void recordAudit({ actionType: "update", objectType: "StandardItem", objectId: item.uuid, objectName: `Пункт ${item.number}`, organizationUuid: item.organizationUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, props: data, host: req.hostname, ip: req.ip });
	res.json({ success: true, item: updated });
}));

router.post("/standard-items/seed", handler("POST /standard-items/seed", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!canManage(ctx)) return fail(res, 403, "Заполняет справочник администратор или руководитель");
	res.json({ success: true, data: { created: await ensureStandardItems(ctx.firmOrgUuid) } });
}));

export default router;
