// ─────────────────────────────────────────────────────────────────────────────
// E17 СК2 — находки проверок учёта в базах 1С клиентов, сверка с лицевым счётом КН,
// отметки о получении первички.
//
//   GET    /check-findings?organizationUuid=&state=open|resolved|exception|all
//   GET    /check-findings/:id
//   POST   /check-findings/:id/exception      решение главбуха с причиной (и сроком)
//   DELETE /check-findings/:id/exception
//   GET    /check-runs?organizationUuid=       журнал прогонов проверок
//   GET|POST /kn-statements, GET /kn-statements/:id   выписка лицевого счёта КН и сравнение
//   GET|POST /primary-docs-receipts, DELETE /primary-docs-receipts/:id
//
// Данные — клиента: доступ по организации (tenantFilter / orgIsAccessible). Исключение
// ставят главбух, руководитель группы клиента или администратор.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { tenantFilter, orgIsAccessible } from "../../utils/auth.js";
import { recordAudit } from "../../services/auditLog.js";
import { qualityContext, userNames, orgNames } from "../../services/quality/access.js";
import { setFindingException, clearFindingException } from "../../services/quality/checks.js";
import { checkTitle, areaOf, exceptionActive, compareKn } from "../../services/quality/findingRules.js";
import { isMonth } from "../../services/quality/time.js";
import { listQuery, pageArgs, listResponse, fail, handler, bodyDate, text } from "../../services/quality/http.js";

const router = express.Router();

const byParam = (id) => {
	const n = Number(id);
	return Number.isInteger(n) && n > 0 ? { id: n } : { uuid: String(id) };
};

/** Может ли пользователь принимать решения по находкам клиента. */
const canDecideFindings = (ctx, org) => ctx.isAdmin || ((ctx.isHead || ctx.isManager) && ctx.clientOrgUuids.has(org));

function decorateFinding(f, names = new Map(), orgs = new Map()) {
	return {
		...f,
		checkTitle: checkTitle(f.checkCode),
		area: areaOf(f.checkCode),
		organizationName: orgs.get(f.organizationUuid) ?? null,
		exceptionActive: exceptionActive(f),
		exceptionByName: names.get(f.exceptionByUuid) ?? null,
		state: f.resolvedAt ? "resolved" : exceptionActive(f) ? "exception" : "open",
	};
}

// ── Находки ───────────────────────────────────────────────────────────────────
router.get("/check-findings", handler("GET /check-findings", async (req, res) => {
	const q = listQuery(req, {
		textFields: ["title", "fingerprint", "checkCode"],
		filterFields: ["checkCode", "severity", "organizationUuid"],
		sortFields: ["id", "firstSeenAt", "lastSeenAt", "severity", "amount", "checkCode"],
		defaultOrder: [{ firstSeenAt: "desc" }],
	});
	Object.assign(q.where, tenantFilter(req));
	if (req.query.organizationUuid) {
		if (!orgIsAccessible(req, String(req.query.organizationUuid))) return res.json(listResponse([], q.take, 0));
		q.where.organizationUuid = String(req.query.organizationUuid);
	}
	// «Открытые» — без действующих исключений; «исключения» — только действующие. Условие —
	// в запросе, а не фильтром после выборки: иначе поедут страницы и итог.
	const state = String(req.query.state || "open");
	const now = new Date();
	if (state === "open") {
		q.where.resolvedAt = null;
		q.where.OR = [{ exceptionAt: null }, { exceptionUntil: { lte: now } }];
	} else if (state === "exception") {
		q.where.resolvedAt = null;
		q.where.exceptionAt = { not: null };
		q.where.OR = [{ exceptionUntil: null }, { exceptionUntil: { gt: now } }];
	} else if (state === "resolved") {
		q.where.resolvedAt = { not: null };
	}
	const [rows, total] = await Promise.all([prisma.checkFinding.findMany(pageArgs(q)), q.cursor ? undefined : prisma.checkFinding.count({ where: q.where })]);
	const [names, orgs] = await Promise.all([userNames(rows.map((f) => f.exceptionByUuid)), orgNames(rows.map((f) => f.organizationUuid))]);
	res.json(listResponse(rows.map((f) => decorateFinding(f, names, orgs)), q.take, total));
}));

router.get("/check-findings/:id", handler("GET /check-findings/:id", async (req, res) => {
	const f = await prisma.checkFinding.findUnique({ where: byParam(req.params.id) });
	if (!f || !orgIsAccessible(req, f.organizationUuid)) return fail(res, 404, "Находка не найдена");
	const ctx = await qualityContext(req);
	const [names, orgs] = await Promise.all([userNames([f.exceptionByUuid]), orgNames([f.organizationUuid])]);
	res.json({ success: true, item: { ...decorateFinding(f, names, orgs), canDecide: canDecideFindings(ctx, f.organizationUuid) } });
}));

router.post("/check-findings/:id/exception", handler("POST /check-findings/:id/exception", async (req, res) => {
	const f = await prisma.checkFinding.findUnique({ where: byParam(req.params.id) });
	if (!f || !orgIsAccessible(req, f.organizationUuid)) return fail(res, 404, "Находка не найдена");
	const ctx = await qualityContext(req);
	if (!canDecideFindings(ctx, f.organizationUuid)) return fail(res, 403, "Решение по находке принимает главбух, руководитель группы клиента или администратор");
	const r = await setFindingException(f, { reason: req.body?.reason, until: req.body?.until || null, userUuid: ctx.userUuid });
	if (r.error) return fail(res, 400, r.error);
	void recordAudit({ actionType: "exception", objectType: "CheckFinding", objectId: f.uuid, objectName: f.title.slice(0, 200), organizationUuid: f.organizationUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, props: { reason: req.body?.reason, until: req.body?.until || null }, host: req.hostname, ip: req.ip });
	res.json({ success: true, item: decorateFinding(r.item) });
}));

router.delete("/check-findings/:id/exception", handler("DELETE /check-findings/:id/exception", async (req, res) => {
	const f = await prisma.checkFinding.findUnique({ where: byParam(req.params.id) });
	if (!f || !orgIsAccessible(req, f.organizationUuid)) return fail(res, 404, "Находка не найдена");
	const ctx = await qualityContext(req);
	if (!canDecideFindings(ctx, f.organizationUuid)) return fail(res, 403, "Снять решение может главбух, руководитель группы клиента или администратор");
	const r = await clearFindingException(f);
	res.json({ success: true, item: decorateFinding(r.item) });
}));

// ── Журнал прогонов ──────────────────────────────────────────────────────────
router.get("/check-runs", handler("GET /check-runs", async (req, res) => {
	const q = listQuery(req, { textFields: ["checkCode", "errorMessage"], filterFields: ["checkCode", "status", "organizationUuid"], sortFields: ["id", "createdAt", "checkCode", "status"], defaultOrder: [{ createdAt: "desc" }] });
	Object.assign(q.where, tenantFilter(req));
	if (req.query.organizationUuid) {
		if (!orgIsAccessible(req, String(req.query.organizationUuid))) return res.json(listResponse([], q.take, 0));
		q.where.organizationUuid = String(req.query.organizationUuid);
	}
	const [rows, total] = await Promise.all([prisma.checkRun.findMany(pageArgs(q)), q.cursor ? undefined : prisma.checkRun.count({ where: q.where })]);
	const orgs = await orgNames(rows.map((r) => r.organizationUuid));
	res.json(listResponse(rows.map((r) => ({ ...r, checkTitle: checkTitle(r.checkCode), organizationName: orgs.get(r.organizationUuid) ?? null })), q.take, total));
}));

// ── Лицевой счёт КН (п. 11) ──────────────────────────────────────────────────
router.get("/kn-statements", handler("GET /kn-statements", async (req, res) => {
	const q = listQuery(req, { filterFields: ["organizationUuid"], sortFields: ["id", "onDate", "createdAt"], defaultOrder: [{ onDate: "desc" }] });
	Object.assign(q.where, tenantFilter(req));
	q.where.deletedAt = null;
	if (req.query.organizationUuid) {
		if (!orgIsAccessible(req, String(req.query.organizationUuid))) return res.json(listResponse([], q.take, 0));
		q.where.organizationUuid = String(req.query.organizationUuid);
	}
	const [rows, total] = await Promise.all([prisma.knStatement.findMany(pageArgs(q)), q.cursor ? undefined : prisma.knStatement.count({ where: q.where })]);
	const [orgs, names] = await Promise.all([orgNames(rows.map((r) => r.organizationUuid)), userNames(rows.map((r) => r.userUuid))]);
	res.json(listResponse(rows.map((r) => ({ ...r, rows: undefined, organizationName: orgs.get(r.organizationUuid) ?? null, userName: names.get(r.userUuid) ?? null, mismatches: r.comparison?.mismatches ?? null })), q.take, total));
}));

router.get("/kn-statements/:id", handler("GET /kn-statements/:id", async (req, res) => {
	const s = await prisma.knStatement.findUnique({ where: byParam(req.params.id) });
	if (!s || s.deletedAt || !orgIsAccessible(req, s.organizationUuid)) return fail(res, 404, "Выписка не найдена");
	const [orgs, names] = await Promise.all([orgNames([s.organizationUuid]), userNames([s.userUuid])]);
	res.json({ success: true, item: { ...s, organizationName: orgs.get(s.organizationUuid) ?? null, userName: names.get(s.userUuid) ?? null } });
}));

/**
 * Загрузить строки выписки лицевого счёта и сравнить с последним снимком `taxes` из 1С.
 * Строки: [{ kbk, name, balance }] — баланс со знаком выписки КН (+ переплата, − долг).
 */
router.post("/kn-statements", handler("POST /kn-statements", async (req, res) => {
	const b = req.body || {};
	const org = text(b.organizationUuid);
	if (!org || !orgIsAccessible(req, org)) return fail(res, 403, "Организация недоступна");
	const onDate = bodyDate(b.onDate, "дата выписки") || new Date();
	const rows = (Array.isArray(b.rows) ? b.rows : [])
		.map((r) => ({ kbk: text(String(r?.kbk ?? "")) || null, name: text(String(r?.name ?? "")) || null, balance: Number(String(r?.balance ?? "").replace(/\s/g, "").replace(",", ".")) }))
		.filter((r) => (r.kbk || r.name) && Number.isFinite(r.balance));
	if (!rows.length) return fail(res, 400, "Нет строк выписки: нужны КБК или наименование и сальдо");
	const snapshot = await prisma.accountingSnapshot.findFirst({ where: { organizationUuid: org, code: "taxes" }, orderBy: { createdAt: "desc" } });
	const comparison = snapshot
		? { ...compareKn(rows, Array.isArray(snapshot.rows) ? snapshot.rows : []), snapshotAt: snapshot.createdAt, snapshotTo: snapshot.periodTo }
		: { rows: rows.map((r) => ({ ...r, knBalance: r.balance, onecBalance: null, diff: null, matched: false, ok: false })), mismatches: rows.length, total: rows.length, snapshotAt: null, note: "Снимка расчётов с бюджетом из 1С ещё нет: ночной прогон проверок учёта его не присылал" };
	const s = await prisma.knStatement.create({ data: { organizationUuid: org, onDate, rows, comparison, userUuid: req.user?.uuid ?? null } });
	res.status(201).json({ success: true, item: s });
}));

// ── Первичка (п. 19) ─────────────────────────────────────────────────────────
router.get("/primary-docs-receipts", handler("GET /primary-docs-receipts", async (req, res) => {
	const q = listQuery(req, { textFields: ["note"], filterFields: ["organizationUuid", "month", "complete"], sortFields: ["id", "month", "receivedAt"], defaultOrder: [{ receivedAt: "desc" }] });
	Object.assign(q.where, tenantFilter(req));
	q.where.deletedAt = null;
	const [rows, total] = await Promise.all([prisma.primaryDocsReceipt.findMany(pageArgs(q)), q.cursor ? undefined : prisma.primaryDocsReceipt.count({ where: q.where })]);
	const [orgs, names] = await Promise.all([orgNames(rows.map((r) => r.organizationUuid)), userNames(rows.map((r) => r.userUuid))]);
	res.json(listResponse(rows.map((r) => ({ ...r, organizationName: orgs.get(r.organizationUuid) ?? null, userName: names.get(r.userUuid) ?? null })), q.take, total));
}));

router.post("/primary-docs-receipts", handler("POST /primary-docs-receipts", async (req, res) => {
	const b = req.body || {};
	const org = text(b.organizationUuid);
	if (!org || !orgIsAccessible(req, org)) return fail(res, 403, "Организация недоступна");
	if (!isMonth(b.month)) return fail(res, 400, "Месяц — в формате ГГГГ-ММ");
	const r = await prisma.primaryDocsReceipt.create({
		data: { organizationUuid: org, month: b.month, receivedAt: bodyDate(b.receivedAt, "дата получения") || new Date(), complete: !!b.complete, note: text(b.note) || null, userUuid: req.user?.uuid ?? null },
	});
	res.status(201).json({ success: true, item: r });
}));

router.delete("/primary-docs-receipts/:id", handler("DELETE /primary-docs-receipts/:id", async (req, res) => {
	const r = await prisma.primaryDocsReceipt.findUnique({ where: byParam(req.params.id) });
	if (!r || r.deletedAt || !orgIsAccessible(req, r.organizationUuid)) return fail(res, 404, "Отметка не найдена");
	await prisma.primaryDocsReceipt.update({ where: { uuid: r.uuid }, data: { deletedAt: new Date() } });
	res.json({ success: true, message: "Удалено" });
}));

export default router;
