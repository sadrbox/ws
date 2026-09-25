// Headless-тесты чистых правил E17 «Стандарт качества» (services/quality/*Rules.js, cron, time).
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS, mergeSettings, settingsPatchError, mergedWorkHoursError } from "../services/quality/settingsRules.js";
import { localParts, localToUtc, addDaysYmd, isoWeekdayOf, addMonths, monthBounds, parseHm, isMonth } from "../services/quality/time.js";
import { parseCron, cronError, nextCronRun } from "../services/quality/cron.js";
import { reactionDueAt, resultError, transitionError, transitionStamps, overdueItemFor, normKind } from "../services/quality/taskRules.js";
import { normalizeFinding, planFindingsSync, standardItemFor, findingDeadlineDays, areaState, exceptionActive, checkTitle, areaOf } from "../services/quality/findingRules.js";
import { computeBonusResults, countsForBonus, windowMonths } from "../services/quality/bonusRules.js";
import { evaluateDay, isWorkday } from "../services/quality/attendanceRules.js";
import { reviewConsultation } from "../services/quality/consultationRules.js";
import { STANDARD_ITEMS, standardItemByNumber } from "../services/quality/standardItems.js";

const OFFSET = 300; // UTC+5

test("стандарт: ровно 40 пунктов, номера 1..40 без пропусков", () => {
	assert.equal(STANDARD_ITEMS.length, 40);
	assert.deepEqual(STANDARD_ITEMS.map((i) => i.number), Array.from({ length: 40 }, (_, i) => i + 1));
	assert.equal(standardItemByNumber(28).appliesTo, "chief");
	assert.equal(standardItemByNumber(30).appliesTo, "manager");
	for (const i of STANDARD_ITEMS) assert.ok(i.text.length > 20 && i.title.length > 3);
});

test("настройки: кривые значения из базы не ломают умолчания", () => {
	const s = mergeSettings({ sla: { reactionMinutes: { normal: "abc", high: 20 } }, tzOffsetMinutes: 360, junk: 1 });
	assert.equal(s.sla.reactionMinutes.normal, DEFAULT_SETTINGS.sla.reactionMinutes.normal);
	assert.equal(s.sla.reactionMinutes.high, 20);
	assert.equal(s.tzOffsetMinutes, 360);
	assert.equal("junk" in s, false);
	assert.deepEqual(mergeSettings({ findings: { perCheckDeadlineDays: { "stock.negative": 2 } } }).findings.perCheckDeadlineDays, { "stock.negative": 2 });
	assert.deepEqual(mergeSettings(null), mergeSettings({}));
});

test("настройки: рабочее время и неделя проверяются до записи", () => {
	assert.equal(settingsPatchError({ workHours: { start: "08:30", end: "17:30" }, workDays: "1,2,3,4,5,6", slaWorkingTime: false }), null);
	assert.equal(settingsPatchError(null), null);
	assert.match(settingsPatchError({ workHours: { start: "25:00", end: "18:00" } }), /ЧЧ:ММ/);
	assert.equal(settingsPatchError({ workHours: { start: "9:00" } }), null, "час одной цифрой — как в графиках сотрудников");
	assert.match(settingsPatchError({ workHours: { start: "9.00" } }), /ЧЧ:ММ/);
	assert.match(settingsPatchError({ workHours: { start: "18:00", end: "09:00" } }), /позже начала/);
	assert.match(settingsPatchError({ workDays: "" }), /хотя бы один/);
	assert.match(settingsPatchError({ workDays: "1,8" }), /хотя бы один/);
	assert.match(settingsPatchError({ slaWorkingTime: "да" }), /да или нет/);
	assert.match(settingsPatchError({ effectiveFrom: "25.09.2026" }), /ГГГГ-ММ-ДД/);
	assert.equal(settingsPatchError({ effectiveFrom: "" }), null, "пустая дата — выключить правила");
	// Частичная правка: прислали только начало — сверяем с сохранённым концом.
	assert.match(mergedWorkHoursError({ workHours: { start: "19:00", end: "18:00" } }), /позже начала/);
	assert.equal(mergedWorkHoursError({ workHours: { start: "08:00", end: "18:00" } }), null);
});

test("время: местная дата по смещению, границы месяца", () => {
	const p = localParts(new Date("2026-09-30T20:30:00Z"), OFFSET); // 01:30 1 октября по Алматы
	assert.equal(p.ymd, "2026-10-01");
	assert.equal(p.ym, "2026-10");
	assert.equal(p.minutes, 90);
	assert.equal(localToUtc("2026-10-01", 9 * 60, OFFSET).toISOString(), "2026-10-01T04:00:00.000Z");
	assert.equal(addDaysYmd("2026-12-31", 1), "2027-01-01");
	assert.equal(isoWeekdayOf("2026-09-27"), 7); // воскресенье
	assert.equal(addMonths("2026-01", -1), "2025-12");
	assert.equal(addMonths("2026-11", 3), "2027-02");
	const b = monthBounds("2026-09", OFFSET);
	assert.equal(b.from.toISOString(), "2026-08-31T19:00:00.000Z");
	assert.equal(b.to.toISOString(), "2026-09-30T19:00:00.000Z");
	assert.equal(parseHm("9:05"), 545);
	assert.equal(parseHm("25:00"), null);
	assert.equal(isMonth("2026-13"), false);
});

test("cron: разбор и ближайший запуск по местному времени", () => {
	assert.equal(cronError("0 9 1 * *"), null);
	assert.match(cronError("0 9 * *"), /пять полей/);
	assert.match(cronError("61 * * * *"), /вне диапазона/);
	const c = parseCron("*/15 8-9 * * 1-5");
	assert.deepEqual([...c.minute], [0, 15, 30, 45]);
	// 1-го числа в 09:00 по Алматы: после 25.09 — 1 октября 04:00 UTC.
	assert.equal(nextCronRun("0 9 1 * *", new Date("2026-09-25T10:00:00Z"), OFFSET).toISOString(), "2026-10-01T04:00:00.000Z");
	// Строго после: ровно в момент запуска — следующий.
	assert.equal(nextCronRun("0 9 * * *", new Date("2026-10-01T04:00:00Z"), OFFSET).toISOString(), "2026-10-02T04:00:00.000Z");
	// По будням: из субботы 26.09 — понедельник 28.09.
	assert.equal(nextCronRun("30 8 * * 1-5", new Date("2026-09-26T05:00:00Z"), OFFSET).toISOString(), "2026-09-28T03:30:00.000Z");
	// Воскресенье как 7.
	assert.equal(nextCronRun("0 10 * * 7", new Date("2026-09-25T00:00:00Z"), OFFSET).toISOString(), "2026-09-27T05:00:00.000Z");
	assert.equal(nextCronRun("0 0 31 2 *", new Date("2026-01-01T00:00:00Z"), OFFSET), null);
});

test("задачи: SLA реакции и формальный результат", () => {
	const s = mergeSettings({});
	const created = new Date("2026-09-25T04:00:00Z");
	assert.equal(reactionDueAt(created, "urgent", s).toISOString(), "2026-09-25T04:15:00.000Z");
	assert.equal(reactionDueAt(created, "мусор", s).toISOString(), "2026-09-25T05:00:00.000Z"); // normal
	assert.match(resultError(""), /Нужен результат/);
	assert.match(resultError("Передала."), /не результат/);
	assert.match(resultError("  позвонила "), /не результат/);
	assert.match(resultError("ок, всё"), /короткий/);
	assert.equal(resultError("Акт сверки подписан, расхождений нет, отражено в 1С"), null);
	assert.equal(normKind("error"), "error");
	assert.equal(normKind("что-то"), "task");
});

test("задачи: переходы статусов — финал требует результата, ожидание — даты", () => {
	const statuses = [
		{ code: "new", isFinal: false }, { code: "in_progress", isFinal: false },
		{ code: "waiting_client", isFinal: false, isWaiting: true },
		{ code: "done", isFinal: true }, { code: "cancelled", isFinal: true },
	];
	assert.match(transitionError({ nextStatus: "done", statuses, result: null }), /результат/);
	assert.equal(transitionError({ nextStatus: "done", statuses, result: "Декларация сдана, талон приложен" }), null);
	assert.equal(transitionError({ nextStatus: "cancelled", statuses, result: null }), null);
	assert.match(transitionError({ nextStatus: "waiting_client", statuses }), /дата следующего контроля/);
	assert.equal(transitionError({ nextStatus: "waiting_client", statuses, nextControlAt: "2026-10-01" }), null);
	const now = new Date("2026-09-25T05:00:00Z");
	assert.deepEqual(transitionStamps({ prevStatus: "new", nextStatus: "in_progress", statuses, startedAt: null, now }), { startedAt: now });
	assert.deepEqual(transitionStamps({ prevStatus: "in_progress", nextStatus: "done", statuses, startedAt: now, now }), { completedAt: now });
	assert.deepEqual(transitionStamps({ prevStatus: "done", nextStatus: "in_progress", statuses, startedAt: now, now }), { completedAt: null });
	assert.equal(overdueItemFor("manager_order"), 35);
	assert.equal(overdueItemFor("control"), 5);
	assert.equal(overdueItemFor("check_finding"), null);
	assert.equal(overdueItemFor("task"), 20);
});

test("находки: нормализация, план синхронизации, обрезанный прогон ничего не закрывает", () => {
	assert.equal(normalizeFinding({ title: "x" }).ok, false);
	assert.equal(normalizeFinding({ fingerprint: "a".repeat(301) }).ok, false);
	const n = normalizeFinding({ fingerprint: "stock.negative:o:1330:p:w:negative", severity: "bogus", amount: "-12000.5", date: "2026-08-31", objects: [{ kind: "product" }] });
	assert.equal(n.ok, true);
	assert.equal(n.value.severity, "warning");
	assert.equal(n.value.amount, -12000.5);
	assert.equal(n.value.title, "stock.negative:o:1330:p:w:negative");

	const existing = [
		{ uuid: "u1", fingerprint: "a", resolvedAt: null },
		{ uuid: "u2", fingerprint: "b", resolvedAt: null },
		{ uuid: "u3", fingerprint: "c", resolvedAt: new Date() },
	];
	const incoming = [{ fingerprint: "a" }, { fingerprint: "c" }, { fingerprint: "d" }, { fingerprint: "d" }];
	const full = planFindingsSync({ existing, incoming, complete: true });
	assert.deepEqual(full.create.map((f) => f.fingerprint), ["d"]);
	assert.deepEqual(full.update.map((u) => [u.uuid, u.reopened]), [["u1", false], ["u3", true]]);
	assert.deepEqual(full.resolve, ["u2"]);
	const cut = planFindingsSync({ existing, incoming, complete: false });
	assert.deepEqual(cut.resolve, []);
});

test("находки: пункт стандарта, срок отработки, состояние участка, исключение", () => {
	assert.equal(standardItemFor("stock.negative", { severity: "error" }), 12);
	assert.equal(standardItemFor("reconciliation.status", { severity: "error", fingerprint: "reconciliation.status:o:c:2026-09-30:formal" }), 8);
	assert.equal(standardItemFor("reconciliation.status", { severity: "warning", data: { details: { status: "missing" } } }), 7);
	assert.equal(standardItemFor("classification.hints", { severity: "info" }), null);
	assert.equal(standardItemFor("new.check", { severity: "error" }), null);
	const s = mergeSettings({ findings: { perCheckDeadlineDays: { "stock.negative": 2 } } });
	assert.equal(findingDeadlineDays("stock.negative", s), 2);
	assert.equal(findingDeadlineDays("documents.unposted", s), 5);
	assert.equal(areaState({ errors: 1 }), "red");
	assert.equal(areaState({ warnings: 2 }), "yellow");
	assert.equal(areaState({}), "green");
	assert.equal(areaState({ hasData: false }), "none");
	assert.equal(exceptionActive({ exceptionAt: new Date(), exceptionUntil: new Date(Date.now() - 1000) }), false);
	assert.equal(exceptionActive({ exceptionAt: new Date(), exceptionUntil: null }), true);
	assert.equal(checkTitle("unknown.x"), "unknown.x");
	assert.equal(areaOf("esf.mismatch"), "taxes");
	assert.equal(areaOf("stock.something_new"), "stock");
});

test("бонус: одно подтверждённое — без бонуса; самовыявленное и кандидат — не в счёт; систематичность", () => {
	const s = mergeSettings({});
	const v = (over) => ({ uuid: Math.random().toString(36), userUuid: "A", itemNumber: 20, description: "x", status: "confirmed", bonusMonth: "2026-09", detectedAt: new Date("2026-09-10"), ...over });
	const rows = computeBonusResults({
		month: "2026-09",
		staff: [{ userUuid: "A", userName: "Айгуль" }, { userUuid: "B", userName: "Болат" }, { userUuid: "C", userName: "Вера" }],
		violations: [
			v({}),
			v({ userUuid: "B", selfDetected: true }),
			v({ userUuid: "C", status: "candidate" }),
			v({ bonusMonth: "2026-08", detectedAt: new Date("2026-08-10") }),
			v({ bonusMonth: "2026-07", detectedAt: new Date("2026-07-10") }),
		],
		measures: [],
		settings: s,
	});
	const a = rows.find((r) => r.userUuid === "A");
	assert.equal(a.bonus, false);
	assert.equal(a.confirmedCount, 1);
	assert.equal(a.windowCount, 3);
	assert.equal(a.systematic, true);
	assert.equal(a.noMeasure, true);
	assert.equal(rows.find((r) => r.userUuid === "B").bonus, true);
	const c = rows.find((r) => r.userUuid === "C");
	assert.equal(c.bonus, true);
	assert.equal(c.pendingCandidates, 1);
	assert.equal(rows[0].userUuid, "A"); // без бонуса — первыми
	const measured = computeBonusResults({ month: "2026-09", staff: [], violations: [v({}), v({ bonusMonth: "2026-08", detectedAt: new Date("2026-08-10") }), v({ bonusMonth: "2026-07", detectedAt: new Date("2026-07-10") })], measures: [{ userUuid: "A", date: new Date("2026-08-01") }], settings: s });
	assert.equal(measured[0].noMeasure, false);
	assert.equal(countsForBonus({ status: "confirmed", selfDetected: false, deletedAt: new Date() }), false);
	assert.deepEqual(windowMonths("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
});

test("посещаемость: опоздание, отсутствие, заявки заранее и задним числом", () => {
	const schedule = { startTime: "09:00", endTime: "18:00", workDays: "1,2,3,4,5", graceMinutes: 10 };
	const ymd = "2026-09-25"; // пятница
	const at = (hm) => localToUtc(ymd, parseHm(hm), OFFSET);
	const evalDay = (o) => evaluateDay({ schedule, ymd, mark: null, requests: [], now: at("20:00"), offsetMinutes: OFFSET, ...o });
	assert.equal(isWorkday(schedule, "2026-09-26"), false);
	assert.equal(evalDay({ ymd: "2026-09-26" }).verdict, "not_workday");
	assert.equal(evalDay({ mark: { markedAt: at("09:08") } }).verdict, "ok");
	const late = evalDay({ mark: { markedAt: at("09:40") } });
	assert.equal(late.item, 32);
	assert.match(late.description, /40 мин/);
	assert.equal(evalDay({ now: at("12:00") }).verdict, "too_early");
	assert.equal(evalDay({}).item, 33);
	const reqBefore = { kind: "late", dateFrom: ymd, dateTo: ymd, status: "approved", createdAt: at("08:00") };
	assert.equal(evalDay({ mark: { markedAt: at("10:30") }, requests: [reqBefore] }).verdict, "ok");
	const reqAfter = { ...reqBefore, createdAt: at("09:30") };
	assert.equal(evalDay({ mark: { markedAt: at("10:30") }, requests: [reqAfter] }).item, 34);
	assert.equal(evalDay({ mark: { markedAt: at("10:30") }, requests: [{ ...reqAfter, unforeseen: true }] }).verdict, "ok");
	assert.equal(evalDay({ requests: [{ kind: "absence", dateFrom: ymd, dateTo: ymd, status: "pending", createdAt: at("07:00") }] }).verdict, "pending");
	// Заявка на опоздание не прикрывает прогул целого дня.
	assert.equal(evalDay({ requests: [reqBefore] }).item, 33);
});

test("консультация: вывод, рекомендация, статья, актуальность, простыня", () => {
	const good = "Вывод: да, можно отнести на вычеты. Рекомендуем отразить расход в 3 квартале. Основание — ст. 242 Налогового кодекса РК в редакции на 25.09.2026.";
	const r = reviewConsultation(good);
	assert.equal(r.ok, true, r.suggestions.join("; "));
	const bad = reviewConsultation("Статья 1. Текст.\nСтатья 2. Текст.\nСтатья 3. Текст.\n" + "бла ".repeat(600));
	assert.equal(bad.ok, false);
	assert.equal(bad.checks.notLawDump, false);
	assert.equal(bad.checks.length, false);
	assert.ok(bad.suggestions.length >= 3);
	assert.equal(reviewConsultation("").ok, false);
});

// ── Рабочее время и производственный календарь РК ────────────────────────────────
import { computeRkCalendar, makeDayKind, workOptions, isWorkingDay, addWorkingMinutes, addWorkingDays, workingDaysBetween } from "../services/quality/workTime.js";

test("календарь РК: праздник в выходной переносится, религиозный — нет", () => {
	const c26 = computeRkCalendar(2026);
	const dayoffs = c26.filter((d) => d.kind === "dayoff").map((d) => d.date);
	// 8 марта — воскресенье → 9 марта; Наурыз 21 (сб) и 22 (вс) → 24 и 25 марта; 9 мая (сб) → 11 мая;
	// 30 августа (вс) → 31 августа; 25 октября (вс) → 26 октября.
	assert.deepEqual(dayoffs, ["2026-03-09", "2026-03-24", "2026-03-25", "2026-05-11", "2026-08-31", "2026-10-26"]);
	assert.ok(c26.some((d) => d.date === "2026-05-27" && d.kind === "holiday"), "Курбан айт 2026");
	const c27 = computeRkCalendar(2027).filter((d) => d.kind === "dayoff").map((d) => d.date);
	assert.deepEqual(c27, ["2027-01-04", "2027-03-24", "2027-05-03", "2027-05-10"]);
	// 7 января 2024 — воскресенье: религиозный праздник без переноса.
	assert.equal(computeRkCalendar(2024).some((d) => d.kind === "dayoff" && d.name.includes("Рождество")), false);
});

test("рабочее время: пятница вечером — срок в понедельник; праздники и переносы пропускаются", () => {
	const s = mergeSettings({});
	const opts = workOptions(s, makeDayKind(computeRkCalendar(2026)));
	// Пятница 25.09 17:55 по Алматы + 60 рабочих минут → понедельник 28.09 09:55.
	assert.equal(addWorkingMinutes(localToUtc("2026-09-25", 17 * 60 + 55, OFFSET), 60, opts).toISOString(), localToUtc("2026-09-28", 9 * 60 + 55, OFFSET).toISOString());
	// Ночью пришедшее обращение: отсчёт с 9:00.
	assert.equal(addWorkingMinutes(localToUtc("2026-09-29", 2 * 60, OFFSET), 15, opts).toISOString(), localToUtc("2026-09-29", 9 * 60 + 15, OFFSET).toISOString());
	// Пятница 20.03 17:30 + 60: 21–23 — выходные и Наурыз, 24–25 — переносы → четверг 26.03 09:30.
	assert.equal(addWorkingMinutes(localToUtc("2026-03-20", 17 * 60 + 30, OFFSET), 60, opts).toISOString(), localToUtc("2026-03-26", 9 * 60 + 30, OFFSET).toISOString());
	// Суббота 26.09 10:00 + 5 рабочих дней → пятница 02.10 10:00.
	assert.equal(addWorkingDays(localToUtc("2026-09-26", 600, OFFSET), 5, opts).toISOString(), localToUtc("2026-10-02", 600, OFFSET).toISOString());
	assert.equal(workingDaysBetween(localToUtc("2026-09-25", 600, OFFSET), localToUtc("2026-09-28", 600, OFFSET), opts), 1);
	assert.equal(isWorkingDay("2026-03-24", opts), false);
	// Рабочая суббота по переносу — рабочий день.
	const withTransfer = workOptions(s, makeDayKind([{ date: "2026-10-03", kind: "workday" }]));
	assert.equal(isWorkingDay("2026-10-03", withTransfer), true);
});
