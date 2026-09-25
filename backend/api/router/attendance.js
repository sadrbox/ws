// ─────────────────────────────────────────────────────────────────────────────
// E17 СК6 — трудовая дисциплина (пп. 32–34): графики, отметка начала дня, заявки.
//
//   GET  /attendance/me                 мой день: график, отметка, мои заявки
//   POST /attendance/mark               «Начал работу» (или авто-отметка при входе — source=login)
//   GET  /attendance/journal?date=      отметки и вердикты видимых сотрудников за день
//   GET|POST /work-schedules, PUT|DELETE /work-schedules/:id     графики
//   GET|POST /absence-requests, DELETE /absence-requests/:id    заявки (свои — всегда)
//   POST /absence-requests/:id/decide   согласовать/отклонить (главбух, руководитель, админ)
//   GET  /work-calendar?year=           производственный календарь (праздники, переносы)
//   POST /work-calendar                 внести/исправить день (админ): {date, kind, name}
//   DELETE /work-calendar/:date         убрать день (админ)
//   POST /work-calendar/seed            заполнить год по закону (админ): {year}
//
// Приход фиксируется по настройке attendance.source; по умолчанию (решено 25.09) — both: кнопка или первый
// вход, что раньше. Авто-отметку при входе панель шлёт сама, если источник login или both; отметка задним
// числом (source=manual) — только для админа. СКУД — отдельный источник, когда появится.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "../../prisma/prisma-client.js";
import { orgIsAccessible } from "../../utils/auth.js";
import { recordAudit } from "../../services/auditLog.js";
import { qualityContext, canSee, canDecide, userNames, decidersOf } from "../../services/quality/access.js";
import { getQualitySettings } from "../../services/quality/settings.js";
import { evaluateDay, ABSENCE_KINDS } from "../../services/quality/attendanceRules.js";
import { localParts, parseHm } from "../../services/quality/time.js";
import { notifyMany } from "../../services/quality/notify.js";
import { getDayKind, loadCalendar, ensureCalendarYear, invalidateCalendar } from "../../services/quality/calendar.js";
import { CALENDAR_KINDS, computeRkCalendar } from "../../services/quality/workTime.js";
import { listQuery, pageArgs, listResponse, fail, handler, text } from "../../services/quality/http.js";

const router = express.Router();
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;

async function firmCtx(req, res) {
	const ctx = await qualityContext(req);
	if (!ctx.firmOrgUuid || !orgIsAccessible(req, ctx.firmOrgUuid)) {
		fail(res, 400, "Не определена организация-фирма: назначьте её в настройках качества");
		return null;
	}
	return ctx;
}

// ── Мой день ──────────────────────────────────────────────────────────────────
router.get("/attendance/me", handler("GET /attendance/me", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const today = localParts(new Date(), settings.tzOffsetMinutes).ymd;
	const [schedule, mark, requests] = await Promise.all([
		prisma.workSchedule.findUnique({ where: { organizationUuid_userUuid: { organizationUuid: ctx.firmOrgUuid, userUuid: ctx.userUuid } } }),
		prisma.workDayMark.findUnique({ where: { organizationUuid_userUuid_date: { organizationUuid: ctx.firmOrgUuid, userUuid: ctx.userUuid, date: today } } }),
		prisma.absenceRequest.findMany({ where: { organizationUuid: ctx.firmOrgUuid, userUuid: ctx.userUuid, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 20 }),
	]);
	res.json({ success: true, data: { today, schedule: schedule?.deletedAt ? null : schedule, mark, requests, source: settings.attendance.source } });
}));

router.post("/attendance/mark", handler("POST /attendance/mark", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const source = ["button", "login", "manual"].includes(req.body?.source) ? req.body.source : "button";
	if (source === "login" && !["login", "both"].includes(settings.attendance.source)) {
		return res.json({ success: true, data: { skipped: true } }); // авто-отметка выключена настройкой
	}
	let userUuid = ctx.userUuid;
	let date = localParts(new Date(), settings.tzOffsetMinutes).ymd;
	let markedAt = new Date();
	if (source === "manual") {
		if (!ctx.isAdmin) return fail(res, 403, "Отметку задним числом ставит только администратор");
		userUuid = text(req.body?.userUuid) || userUuid;
		if (!ymdRe.test(String(req.body?.date || ""))) return fail(res, 400, "Дата — ГГГГ-ММ-ДД");
		date = req.body.date;
		const hm = parseHm(req.body?.time);
		if (hm === null) return fail(res, 400, "Время — ЧЧ:ММ");
		markedAt = new Date(Date.UTC(...date.split("-").map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) + (hm - settings.tzOffsetMinutes) * 60_000);
	}
	// Первая отметка дня — окончательная: повторное нажатие её не сдвигает (иначе опоздание
	// «исправлялось» бы повторной отметкой позже или раньше).
	const existing = await prisma.workDayMark.findUnique({ where: { organizationUuid_userUuid_date: { organizationUuid: ctx.firmOrgUuid, userUuid, date } } });
	if (existing && source !== "manual") return res.json({ success: true, data: { mark: existing, already: true } });
	const mark = await prisma.workDayMark.upsert({
		where: { organizationUuid_userUuid_date: { organizationUuid: ctx.firmOrgUuid, userUuid, date } },
		create: { organizationUuid: ctx.firmOrgUuid, userUuid, date, markedAt, source, note: text(req.body?.note) || null },
		update: { markedAt, source, note: text(req.body?.note) || null },
	});
	if (source === "manual") void recordAudit({ actionType: "update", objectType: "WorkDayMark", objectId: mark.uuid, objectName: `Отметка ${date}`, organizationUuid: ctx.firmOrgUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, props: { userUuid, date, time: req.body?.time }, host: req.hostname, ip: req.ip });
	res.json({ success: true, data: { mark } });
}));

router.get("/attendance/journal", handler("GET /attendance/journal", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const date = ymdRe.test(String(req.query.date || "")) ? String(req.query.date) : localParts(new Date(), settings.tzOffsetMinutes).ymd;
	const schedules = await prisma.workSchedule.findMany({ where: { organizationUuid: ctx.firmOrgUuid, deletedAt: null, ...(ctx.visible ? { userUuid: { in: [...ctx.visible] } } : {}) } });
	const uids = schedules.map((s) => s.userUuid);
	const [marks, requests, names] = await Promise.all([
		prisma.workDayMark.findMany({ where: { organizationUuid: ctx.firmOrgUuid, date, userUuid: { in: uids } } }),
		prisma.absenceRequest.findMany({ where: { organizationUuid: ctx.firmOrgUuid, deletedAt: null, userUuid: { in: uids }, dateFrom: { lte: date }, dateTo: { gte: date } } }),
		userNames(uids),
	]);
	const now = new Date();
	const dayKind = await getDayKind();
	const items = schedules.map((s) => {
		const mark = marks.find((m) => m.userUuid === s.userUuid) || null;
		const reqs = requests.filter((r) => r.userUuid === s.userUuid);
		return { userUuid: s.userUuid, userName: names.get(s.userUuid) ?? s.userUuid, schedule: s, mark, requests: reqs, verdict: evaluateDay({ schedule: s, ymd: date, mark, requests: reqs, now, offsetMinutes: settings.tzOffsetMinutes, dayKind }) };
	});
	res.json({ success: true, data: { date, items } });
}));

// ── Графики ───────────────────────────────────────────────────────────────────
router.get("/work-schedules", handler("GET /work-schedules", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const q = listQuery(req, { filterFields: ["userUuid", "isActive"], sortFields: ["id", "startTime"] });
	q.where.organizationUuid = ctx.firmOrgUuid;
	q.where.deletedAt = null;
	if (ctx.visible) q.where.userUuid = { in: [...ctx.visible] };
	const [rows, total] = await Promise.all([prisma.workSchedule.findMany(pageArgs(q)), q.cursor ? undefined : prisma.workSchedule.count({ where: q.where })]);
	const names = await userNames(rows.map((r) => r.userUuid));
	res.json(listResponse(rows.map((r) => ({ ...r, userName: names.get(r.userUuid) ?? r.userUuid })), q.take, total));
}));

router.get("/work-schedules/:id", handler("GET /work-schedules/:id", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const s = await prisma.workSchedule.findUnique({ where: { uuid: String(req.params.id) } });
	if (!s || s.deletedAt || s.organizationUuid !== ctx.firmOrgUuid || !canSee(ctx, s.userUuid)) return fail(res, 404, "График не найден");
	const names = await userNames([s.userUuid]);
	res.json({ success: true, item: { ...s, userName: names.get(s.userUuid) ?? null } });
}));

function scheduleData(b) {
	const data = {};
	if (b.startTime !== undefined) { if (parseHm(b.startTime) === null) throw new Error("Начало дня — ЧЧ:ММ"); data.startTime = b.startTime; }
	if (b.endTime !== undefined) { if (parseHm(b.endTime) === null) throw new Error("Конец дня — ЧЧ:ММ"); data.endTime = b.endTime; }
	if (b.workDays !== undefined) {
		const days = String(b.workDays).split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 7);
		if (!days.length) throw new Error("Рабочие дни — числа 1..7 через запятую");
		data.workDays = [...new Set(days)].sort().join(",");
	}
	if (b.graceMinutes !== undefined) {
		const g = Number(b.graceMinutes);
		if (!Number.isInteger(g) || g < 0 || g > 240) throw new Error("Допуск опоздания — от 0 до 240 минут");
		data.graceMinutes = g;
	}
	if (b.isActive !== undefined) data.isActive = !!b.isActive;
	return data;
}

router.post("/work-schedules", handler("POST /work-schedules", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const userUuid = text(req.body?.userUuid);
	if (!userUuid) return fail(res, 400, "Укажите сотрудника");
	if (!canDecide(ctx, userUuid) && !ctx.isAdmin) return fail(res, 403, "График задаёт главбух, руководитель или администратор");
	let data;
	try { data = scheduleData(req.body || {}); } catch (e) { return fail(res, 400, e.message); }
	const s = await prisma.workSchedule.upsert({
		where: { organizationUuid_userUuid: { organizationUuid: ctx.firmOrgUuid, userUuid } },
		create: { organizationUuid: ctx.firmOrgUuid, userUuid, ...data },
		update: { ...data, deletedAt: null },
	});
	res.status(201).json({ success: true, item: s });
}));

router.put("/work-schedules/:id", handler("PUT /work-schedules/:id", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const s = await prisma.workSchedule.findUnique({ where: { uuid: String(req.params.id) } });
	if (!s || s.deletedAt || s.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "График не найден");
	if (!canDecide(ctx, s.userUuid) && !ctx.isAdmin) return fail(res, 403, "График задаёт главбух, руководитель или администратор");
	let data;
	try { data = scheduleData(req.body || {}); } catch (e) { return fail(res, 400, e.message); }
	res.json({ success: true, item: await prisma.workSchedule.update({ where: { uuid: s.uuid }, data }) });
}));

router.delete("/work-schedules/:id", handler("DELETE /work-schedules/:id", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const s = await prisma.workSchedule.findUnique({ where: { uuid: String(req.params.id) } });
	if (!s || s.deletedAt || s.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "График не найден");
	if (!canDecide(ctx, s.userUuid) && !ctx.isAdmin) return fail(res, 403, "График задаёт главбух, руководитель или администратор");
	await prisma.workSchedule.update({ where: { uuid: s.uuid }, data: { deletedAt: new Date() } });
	res.json({ success: true, message: "Удалено" });
}));

// ── Заявки ────────────────────────────────────────────────────────────────────
router.get("/absence-requests", handler("GET /absence-requests", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const q = listQuery(req, { textFields: ["reason"], filterFields: ["status", "kind", "userUuid"], sortFields: ["id", "dateFrom", "createdAt", "status"], defaultOrder: [{ createdAt: "desc" }] });
	q.where.organizationUuid = ctx.firmOrgUuid;
	q.where.deletedAt = null;
	if (ctx.visible) q.where.userUuid = { in: [...ctx.visible] };
	if (req.query.mine === "1") q.where.userUuid = ctx.userUuid;
	const [rows, total] = await Promise.all([prisma.absenceRequest.findMany(pageArgs(q)), q.cursor ? undefined : prisma.absenceRequest.count({ where: q.where })]);
	const names = await userNames(rows.flatMap((r) => [r.userUuid, r.decidedByUuid]));
	res.json(listResponse(rows.map((r) => ({ ...r, userName: names.get(r.userUuid) ?? null, decidedByName: names.get(r.decidedByUuid) ?? null, canDecide: r.status === "pending" && canDecide(ctx, r.userUuid) })), q.take, total));
}));

// Карточка заявки — сюда ведут уведомления «Заявка: …». Своя — всегда, чужая — кому виден сотрудник.
router.get("/absence-requests/:id", handler("GET /absence-requests/:id", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const r = await prisma.absenceRequest.findUnique({ where: { uuid: String(req.params.id) } });
	if (!r || r.deletedAt || r.organizationUuid !== ctx.firmOrgUuid || !canSee(ctx, r.userUuid)) return fail(res, 404, "Заявка не найдена");
	const names = await userNames([r.userUuid, r.decidedByUuid]);
	res.json({ success: true, item: { ...r, userName: names.get(r.userUuid) ?? null, decidedByName: names.get(r.decidedByUuid) ?? null, canDecide: r.status === "pending" && canDecide(ctx, r.userUuid) } });
}));

router.post("/absence-requests", handler("POST /absence-requests", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const b = req.body || {};
	const kind = ABSENCE_KINDS.includes(b.kind) ? b.kind : null;
	if (!kind) return fail(res, 400, "Вид заявки: опоздание, отсутствие или изменение графика");
	if (!ymdRe.test(String(b.dateFrom || "")) || !ymdRe.test(String(b.dateTo || b.dateFrom || ""))) return fail(res, 400, "Даты — ГГГГ-ММ-ДД");
	const dateTo = b.dateTo || b.dateFrom;
	if (dateTo < b.dateFrom) return fail(res, 400, "Конец периода раньше начала");
	const reason = text(b.reason);
	if (reason.length < 5) return fail(res, 400, "Укажите причину");
	const r = await prisma.absenceRequest.create({
		data: { organizationUuid: ctx.firmOrgUuid, userUuid: ctx.userUuid, kind, dateFrom: b.dateFrom, dateTo, timeFrom: text(b.timeFrom) || null, timeTo: text(b.timeTo) || null, reason },
	});
	const names = await userNames([ctx.userUuid]);
	await notifyMany(await decidersOf(ctx.firmOrgUuid, ctx.userUuid, ctx.groups), {
		kind: "absence_request", title: `Заявка: ${{ late: "опоздание", absence: "отсутствие", schedule_change: "изменение графика" }[kind]} — ${names.get(ctx.userUuid) ?? ""}`,
		body: `${b.dateFrom}${dateTo !== b.dateFrom ? ` — ${dateTo}` : ""}: ${reason}`, link: { endpoint: "absence-requests", uuid: r.uuid }, organizationUuid: ctx.firmOrgUuid, dedupKey: `absence:${r.uuid}`,
	});
	res.status(201).json({ success: true, item: r });
}));

router.post("/absence-requests/:id/decide", handler("POST /absence-requests/:id/decide", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const r = await prisma.absenceRequest.findUnique({ where: { uuid: String(req.params.id) } });
	if (!r || r.deletedAt || r.organizationUuid !== ctx.firmOrgUuid || !canSee(ctx, r.userUuid)) return fail(res, 404, "Заявка не найдена");
	if (!canDecide(ctx, r.userUuid)) return fail(res, 403, "Согласует главбух, руководитель или администратор");
	const status = req.body?.status === "approved" ? "approved" : req.body?.status === "rejected" ? "rejected" : null;
	if (!status) return fail(res, 400, "Решение: approved или rejected");
	const updated = await prisma.absenceRequest.update({
		where: { uuid: r.uuid },
		data: { status, unforeseen: status === "approved" && !!req.body?.unforeseen, decidedByUuid: ctx.userUuid, decidedAt: new Date(), decisionNote: text(req.body?.note) || null },
	});
	res.json({ success: true, item: updated });
}));

router.delete("/absence-requests/:id", handler("DELETE /absence-requests/:id", async (req, res) => {
	const ctx = await firmCtx(req, res);
	if (!ctx) return;
	const r = await prisma.absenceRequest.findUnique({ where: { uuid: String(req.params.id) } });
	if (!r || r.deletedAt || r.organizationUuid !== ctx.firmOrgUuid) return fail(res, 404, "Заявка не найдена");
	if (!(r.userUuid === ctx.userUuid && r.status === "pending") && !ctx.isAdmin) return fail(res, 403, "Отозвать можно свою несогласованную заявку");
	await prisma.absenceRequest.update({ where: { uuid: r.uuid }, data: { deletedAt: new Date() } });
	res.json({ success: true, message: "Удалено" });
}));

// ── Производственный календарь (общий на установку) ──────────────────────────
// Читают все: по нему считаются сроки и посещаемость, и человек вправе видеть, почему срок такой.
// Правит администратор фирмы: переносы по постановлению Правительства и дату Курбан айта.
router.get("/work-calendar", handler("GET /work-calendar", async (req, res) => {
	const year = req.query.year ? Number(req.query.year) : localParts(new Date(), 300).year;
	// Год без записей заполняется по закону при первом чтении — поэтому только разумные годы.
	if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail(res, 400, "Год — от 2020 до 2100");
	await ensureCalendarYear(year);
	const all = await loadCalendar();
	const items = all.filter((d) => d.date.startsWith(`${year}-`));
	// Что предлагает закон на этот год — чтобы экран показал расхождение с внесённым руками.
	const byLaw = computeRkCalendar(year);
	res.json({ success: true, data: { year, items, byLaw } });
}));

router.post("/work-calendar", handler("POST /work-calendar", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!ctx.isAdmin) return fail(res, 403, "Производственный календарь правит администратор");
	const date = String(req.body?.date || "");
	const kind = String(req.body?.kind || "");
	if (!ymdRe.test(date)) return fail(res, 400, "Дата — ГГГГ-ММ-ДД");
	if (!CALENDAR_KINDS.includes(kind)) return fail(res, 400, "Вид дня: holiday (праздник), dayoff (перенесённый выходной) или workday (рабочий день-перенос)");
	const name = text(req.body?.name) || null;
	const row = await prisma.workCalendarDay.upsert({
		where: { date },
		create: { date, kind, name, source: "manual" },
		update: { kind, name, source: "manual" },
	});
	invalidateCalendar();
	void recordAudit({ actionType: "update", objectType: "WorkCalendarDay", objectId: row.uuid, objectName: `Календарь ${date}`, organizationUuid: ctx.firmOrgUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, props: { date, kind, name }, host: req.hostname, ip: req.ip });
	res.json({ success: true, item: row });
}));

router.delete("/work-calendar/:date", handler("DELETE /work-calendar/:date", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!ctx.isAdmin) return fail(res, 403, "Производственный календарь правит администратор");
	const date = String(req.params.date || "");
	if (!ymdRe.test(date)) return fail(res, 400, "Дата — ГГГГ-ММ-ДД");
	await prisma.workCalendarDay.deleteMany({ where: { date } });
	invalidateCalendar();
	void recordAudit({ actionType: "delete", objectType: "WorkCalendarDay", objectId: date, objectName: `Календарь ${date}`, organizationUuid: ctx.firmOrgUuid, user: { uuid: req.user?.uuid, username: req.user?.username }, host: req.hostname, ip: req.ip });
	res.json({ success: true, message: "Удалено" });
}));

router.post("/work-calendar/seed", handler("POST /work-calendar/seed", async (req, res) => {
	const ctx = await qualityContext(req);
	if (!ctx.isAdmin) return fail(res, 403, "Производственный календарь правит администратор");
	const year = Number(req.body?.year);
	if (!Number.isInteger(year) || year < 2020 || year > 2100) return fail(res, 400, "Год — от 2020 до 2100");
	// Недостающие по закону дни дописываются; внесённое руками не трогаем.
	const rows = computeRkCalendar(year).map((d) => ({ ...d, source: "seed" }));
	const r = await prisma.workCalendarDay.createMany({ data: rows, skipDuplicates: true });
	invalidateCalendar();
	res.json({ success: true, data: { year, created: r.count } });
}));

export default router;
