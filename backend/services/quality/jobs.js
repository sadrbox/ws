// Периодические правила E17 — регистрируются в едином планировщике (services/scheduler.js,
// под кластерной блокировкой). Каждое правило ИДЕМПОТЕНТНО: кандидаты — по ruleKey,
// уведомления — по dedupKey, поэтому повторный запуск (или два процесса) не плодит дублей.
//
//   quality-sla          — обращения без реакции (п. 3), просрочки (пп. 20, 35, 5), ожидание
//                          с наступившей датой контроля, задачи без движения (пп. 21, 40), сигнал
//                          наблюдателям переданных задач (п. 22);
//   quality-regulation   — регламентные задачи по расписанию (ScheduledTask.cronExpr, СК1.7);
//   quality-findings     — кандидаты по неотработанным находкам проверок учёта (СК2.4);
//   quality-attendance   — опоздания и отсутствие без согласования (пп. 32–34).
import { prisma } from "../../prisma/prisma-client.js";
import { getQualitySettings, getFirmOrgSetting } from "./settings.js";
import { overdueItemFor, deadlineDueAt } from "./taskRules.js";
import { loadGroups, chiefsOf, managersOf, firmOrgForUser, userNames } from "./access.js";
import { createCandidate } from "./violations.js";
import { notifyUser, notifyMany } from "./notify.js";
import { loadStatuses, logEvent } from "./todos.js";
import { nextCronRun } from "./cron.js";
import { localParts, addDaysYmd } from "./time.js";
import { evaluateDay } from "./attendanceRules.js";
import { getWorkOptions, getDayKind } from "./calendar.js";
import { workingDaysBetween } from "./workTime.js";
import { firmScope, todoScopeWhere } from "./scope.js";
import { sentNotificationKeys, existingRuleKeys, manyKeys, freshRecipients } from "./dedupBatch.js";
import { orgTimeZone, localDateOf } from "../periodBounds.js";

export { runFindingCandidates } from "./checks.js";

const DAY = 86_400_000;
const pad2 = (n) => String(n).padStart(2, "0");
/** Местная дата момента «ГГГГ-ММ-ДД» — для текста кандидата. */
const localYmd = (d, tz) => { const c = localDateOf(d, tz); return `${c.y}-${pad2(c.m)}-${pad2(c.d)}`; };
const label = (t) => t.name || t.description?.slice(0, 80) || `#${t.id}`;
const link = (t) => ({ endpoint: "todos", uuid: t.uuid });

/** Задач на страницу: правила идут по ВСЕМ подходящим задачам постранично (Н6 аудита 26.09). */
export const SLA_PAGE = 200;

/**
 * Все задачи по условию — страницами по возрастанию id (ключевой обход без OFFSET). Раньше было
 * `take: 1000` без сортировки: задачи сверх тысячи не обрабатывались никогда, а какие именно
 * попадут в тысячу, решал план запроса.
 */
async function* todoPages(where, pageSize = SLA_PAGE) {
	let after = 0;
	for (;;) {
		const rows = await prisma.todo.findMany({ where: { ...where, id: { gt: after } }, orderBy: { id: "asc" }, take: pageSize });
		if (!rows.length) return;
		yield rows;
		if (rows.length < pageSize) return;
		after = rows[rows.length - 1].id;
	}
}

/**
 * Правила по срокам задач.
 *
 * ОХВАТ — задачи фирмы и её клиентов (scope.js), а не всей установки. ДУБЛИ — ключи уже сделанного
 * (кандидаты, уведомления) проверяются одним запросом на страницу (dedupBatch.js), и записывается
 * только новое: повторный тик по тем же просрочкам — это три-четыре SELECT на страницу, а не тысячи
 * упавших INSERT в журнале PostgreSQL.
 */
export async function runSlaJob(now = new Date()) {
	const firm = await getFirmOrgSetting();
	// Учёт качества включается назначением организации-фирмы («Качество → Настройки»): до этого
	// правила стандарта молчат — ни кандидатов, ни эскалаций по старым задачам.
	if (!firm) return undefined;
	const settings = await getQualitySettings(firm);
	const work = await getWorkOptions(settings);
	const tz = orgTimeZone(firm);
	// Дни просрочки и простоя — рабочие: выходные и праздники не «копят» просрочку и простой.
	const daysSince = (from) => (work ? workingDaysBetween(from, now, work) : Math.floor((now.getTime() - new Date(from).getTime()) / DAY));
	const statuses = await loadStatuses();
	const finals = statuses.filter((s) => s.isFinal).map((s) => s.code);
	const waiting = statuses.filter((s) => s.isWaiting).map((s) => s.code);
	// Группы — только фирмы: главбухи и руководители чужих организаций установки здесь ни при чём.
	const groups = await loadGroups(firm);
	const inScope = todoScopeWhere(await firmScope(firm, groups, now));
	const open = { deletedAt: null, status: { notIn: finals.length ? finals : ["done", "cancelled"] }, AND: [inScope] };
	let candidates = 0;
	let signals = 0;

	// 1. Обращения клиента, не принятые к сроку реакции — п. 3.
	for await (const page of todoPages({ ...open, kind: "client_request", acceptedAt: null, reactionDueAt: { lt: now } })) {
		const chiefsBy = new Map();
		for (const t of page) chiefsBy.set(t.uuid, t.executorUuid ? await chiefsOf(t.executorUuid, groups) : chiefsForClient(groups, t.organizationUuid));
		const [haveRule, sent] = await Promise.all([
			existingRuleKeys(page.filter((t) => t.executorUuid).map((t) => `sla_reaction:${t.uuid}`)),
			sentNotificationKeys(page.flatMap((t) => manyKeys(chiefsBy.get(t.uuid), `sla:${t.uuid}`))),
		]);
		for (const t of page) {
			if (t.executorUuid && !haveRule.has(`sla_reaction:${t.uuid}`)) {
				const c = await createCandidate({
					userUuid: t.executorUuid, itemNumber: 3, rule: "sla_reaction", ruleKey: `sla_reaction:${t.uuid}`,
					clientOrganizationUuid: t.organizationUuid, occurredAt: t.reactionDueAt,
					description: `Обращение клиента не принято в работу к сроку реакции (${t.reactionDueAt.toISOString().slice(0, 16).replace("T", " ")} UTC): «${label(t)}»`,
					evidence: [{ kind: "todo", uuid: t.uuid, label: label(t) }],
				});
				if (c) candidates++;
			}
			// Без исполнителя — обращение повисло «ничьим»: сигнал ответственным главбухам.
			const to = freshRecipients(chiefsBy.get(t.uuid), `sla:${t.uuid}`, sent);
			if (to.length) signals += (await notifyMany(to, { kind: "sla", title: `Обращение без реакции: ${label(t)}`, link: link(t), organizationUuid: t.organizationUuid, dedupKey: `sla:${t.uuid}` })).length;
		}
	}

	// 2. Просрочки: п. 20 (срок), п. 35 (поручение руководителя), п. 5 (проверка исправления).
	// Отбор в базе — по записанному сроку (грубый); истёк ли он — по deadlineDueAt (taskRules.js): срок
	// голой датой (00:00Z) действует до конца местного дня, а не до 05:00 утра по Алматы.
	for await (const page of todoPages({ ...open, deadline: { lt: now }, executorUuid: { not: null } })) {
		const watchers = await prisma.todoWatcher.findMany({ where: { todoUuid: { in: page.map((t) => t.uuid) } }, select: { todoUuid: true, userUuid: true } });
		const plan = [];
		for (const t of page) {
			const due = deadlineDueAt(t.deadline, tz);
			if (!(due < now)) continue; // срок «сегодня» ещё идёт
			const chiefs = await chiefsOf(t.executorUuid, groups);
			const late = daysSince(due) >= settings.escalation.overdueToManagerDays;
			const managers = late ? await managersOf(t.executorUuid, groups) : [];
			plan.push({ t, due, item: overdueItemFor(t.kind), chiefs, late, managers, watchers: watchers.filter((w) => w.todoUuid === t.uuid).map((w) => w.userUuid) });
		}
		const [haveRule, sent] = await Promise.all([
			existingRuleKeys(plan.filter((p) => p.item).map((p) => `overdue:${p.t.uuid}`)),
			sentNotificationKeys(plan.flatMap((p) => [
				...manyKeys(p.chiefs, `overdue-chief:${p.t.uuid}`),
				...manyKeys(p.managers, `overdue-manager:${p.t.uuid}`),
				...manyKeys(p.watchers, `watch-overdue:${p.t.uuid}`),
			])),
		]);
		for (const { t, due, item, chiefs, late, managers, watchers: ws } of plan) {
			if (item && !haveRule.has(`overdue:${t.uuid}`)) {
				const c = await createCandidate({
					userUuid: t.executorUuid, itemNumber: item, rule: `overdue_${t.kind}`, ruleKey: `overdue:${t.uuid}`,
					clientOrganizationUuid: t.organizationUuid, occurredAt: due,
					description: `${t.kind === "manager_order" ? "Поручение руководителя" : t.kind === "control" ? "Проверка исправления ошибки" : "Задача"} не выполнена в срок (${localYmd(due, tz)}): «${label(t)}»`,
					evidence: [{ kind: "todo", uuid: t.uuid, label: label(t) }],
				});
				if (c) candidates++;
			}
			// Эскалация: главбух — сразу, руководитель — через N дней просрочки.
			const toChiefs = freshRecipients(chiefs, `overdue-chief:${t.uuid}`, sent);
			if (toChiefs.length) signals += (await notifyMany(toChiefs, { kind: "overdue", title: `Просрочена задача: ${label(t)}`, link: link(t), organizationUuid: t.organizationUuid, dedupKey: `overdue-chief:${t.uuid}` })).length;
			let level = Math.max(t.escalationLevel || 0, chiefs.length ? 1 : 0);
			if (late) {
				const toManagers = freshRecipients(managers, `overdue-manager:${t.uuid}`, sent);
				if (toManagers.length) signals += (await notifyMany(toManagers, { kind: "overdue", title: `Просрочка дольше ${settings.escalation.overdueToManagerDays} дн.: ${label(t)}`, link: link(t), organizationUuid: t.organizationUuid, dedupKey: `overdue-manager:${t.uuid}` })).length;
				if (managers.length) level = Math.max(level, 2);
			}
			if (level !== (t.escalationLevel || 0)) {
				await prisma.todo.update({ where: { uuid: t.uuid }, data: { escalationLevel: level, escalatedAt: now } });
				await logEvent(t.uuid, { type: "escalation", channel: "system", payload: { level } });
			}
			// п. 22: передавший задачу — наблюдатель; просрочка у преемника — сигнал ему.
			const toWatchers = freshRecipients(ws, `watch-overdue:${t.uuid}`, sent);
			if (toWatchers.length) signals += (await notifyMany(toWatchers, { kind: "watch", title: `Переданная вами задача просрочена: ${label(t)}`, link: link(t), organizationUuid: t.organizationUuid, dedupKey: `watch-overdue:${t.uuid}` })).length;
		}
	}

	// 3. Ожидание с наступившей датой контроля — напоминание исполнителю.
	if (waiting.length) {
		for await (const page of todoPages({ deletedAt: null, status: { in: waiting }, nextControlAt: { lt: now }, executorUuid: { not: null }, AND: [inScope] })) {
			const keyOf = (t) => `control-date:${t.uuid}:${t.nextControlAt.toISOString()}`;
			const sent = await sentNotificationKeys(page.map(keyOf));
			for (const t of page) {
				if (sent.has(keyOf(t))) continue;
				const n = await notifyUser(t.executorUuid, { kind: "control_date", title: `Дата контроля наступила: ${label(t)}`, body: "Задача ждёт клиента или контрагента — пора проверить и продвинуть.", link: link(t), organizationUuid: t.organizationUuid, dedupKey: keyOf(t) });
				if (n) {
					signals++;
					await logEvent(t.uuid, { type: "control_date", channel: "system" });
				}
			}
		}
	}

	// 4. Без движения: напоминание исполнителю, дольше — сигнал главбуху (пп. 21, 40).
	const idleSince = new Date(now.getTime() - settings.escalation.idleDays * DAY);
	const idleWhere = { ...open, ...(waiting.length ? { status: { notIn: [...finals, ...waiting] } } : {}), executorUuid: { not: null }, lastActivityAt: { lt: idleSince } };
	for await (const page of todoPages(idleWhere)) {
		const plan = [];
		for (const t of page) {
			// Отбор выше — календарный (грубый); здесь — рабочие дни: «три дня без движения» после
			// выходных — это пятница, суббота, воскресенье, а не повод напоминать в понедельник утром.
			const idleDays = daysSince(t.lastActivityAt);
			if (idleDays < settings.escalation.idleDays) continue;
			const stamp = t.lastActivityAt.toISOString();
			const chiefs = idleDays >= settings.escalation.idleToChiefDays && !t.helpRequestedAt ? await chiefsOf(t.executorUuid, groups) : [];
			plan.push({ t, idleDays, own: `idle:${t.uuid}:${stamp}`, chiefBase: `idle-chief:${t.uuid}:${stamp}`, chiefs });
		}
		const sent = await sentNotificationKeys(plan.flatMap((p) => [p.own, ...manyKeys(p.chiefs, p.chiefBase)]));
		for (const { t, idleDays, own, chiefBase, chiefs } of plan) {
			if (!sent.has(own)) {
				signals += (await notifyUser(t.executorUuid, { kind: "idle", title: `Задача без движения ${idleDays} дн.: ${label(t)}`, body: "Если не получается — нажмите «Нужна помощь»: это не нарушение, а своевременная эскалация.", link: link(t), organizationUuid: t.organizationUuid, dedupKey: own })) ? 1 : 0;
			}
			const toChiefs = freshRecipients(chiefs, chiefBase, sent);
			if (toChiefs.length) signals += (await notifyMany(toChiefs, { kind: "idle", title: `Задача без движения ${idleDays} дн., помощь не запрошена: ${label(t)}`, link: link(t), organizationUuid: t.organizationUuid, dedupKey: chiefBase })).length;
		}
	}
	return candidates || signals ? `кандидатов: ${candidates}, сигналов: ${signals}` : undefined;
}

function chiefsForClient(groups, clientOrgUuid) {
	const out = new Set();
	for (const g of groups) {
		const c = g.clients.find((x) => x.clientOrganizationUuid === clientOrgUuid);
		if (!c) continue;
		if (c.responsibleUuid) out.add(c.responsibleUuid);
		if (g.headUuid) out.add(g.headUuid);
	}
	return [...out];
}

/**
 * Регламентные задачи по расписанию (СК1.7). Для группы — задача каждому ответственному по
 * каждому клиенту группы; без группы — одна задача исполнителю в организации расписания.
 */
export async function runScheduledTasks(now = new Date()) {
	const firm = await getFirmOrgSetting();
	const settings = await getQualitySettings(firm);
	const rows = await prisma.scheduledTask.findMany({ where: { deletedAt: null, status: "active", kind: "regulation", cronExpr: { not: null } } });
	let created = 0;
	for (const st of rows) {
		let next;
		try {
			// Первый запуск считаем от момента, когда расписание увидели впервые, а не от создания:
			// иначе расписание, заведённое месяц назад, выстрелило бы разом за всё прошлое.
			next = st.nextRunAt ?? nextCronRun(st.cronExpr, st.lastRunAt ?? now, settings.tzOffsetMinutes);
		} catch (e) {
			console.warn(`[quality] расписание «${st.name}»: ${e.message}`);
			continue;
		}
		if (!st.nextRunAt) {
			await prisma.scheduledTask.update({ where: { uuid: st.uuid }, data: { nextRunAt: next } });
			continue;
		}
		if (!next || next.getTime() > now.getTime()) continue;
		// ЗАХВАТ ЗАПУСКА — условным обновлением, а не надеждой на блокировку планировщика: в production
		// бэкенд идёт кластером, и если advisory-лок не взялся (или его вызов упал и задача пошла без
		// него), четыре процесса создали бы по регламентной задаче каждый. Обновление «где nextRunAt
		// всё ещё тот, что я прочитал» проходит ровно у одного — остальные видят count = 0 и уходят.
		let following = null;
		try { following = nextCronRun(st.cronExpr, now, settings.tzOffsetMinutes); } catch { following = null; }
		const claimed = await prisma.scheduledTask.updateMany({ where: { uuid: st.uuid, nextRunAt: st.nextRunAt }, data: { lastRunAt: now, nextRunAt: following } });
		if (claimed.count !== 1) continue;
		const targets = [];
		if (st.staffGroupUuid) {
			const clients = await prisma.staffGroupClient.findMany({ where: { groupUuid: st.staffGroupUuid, group: { deletedAt: null } } });
			for (const c of clients) targets.push({ organizationUuid: c.clientOrganizationUuid, executorUuid: c.responsibleUuid });
		} else {
			targets.push({ organizationUuid: st.organizationUuid, executorUuid: st.executorUuid });
		}
		const deadline = st.deadlineDays ? new Date(now.getTime() + st.deadlineDays * DAY) : null;
		for (const t of targets) {
			const todo = await prisma.todo.create({
				data: {
					name: st.name, description: st.description, organizationUuid: t.organizationUuid, executorUuid: t.executorUuid,
					curatorUuid: st.authorUuid, deadline, kind: "regulation", lastActivityAt: now,
					origin: "schedule", originLabel: `Расписание «${st.name}»`, sourceType: "scheduled-tasks", sourceUuid: st.uuid, sourceLabel: st.name,
				},
			});
			await logEvent(todo.uuid, { type: "created", channel: "system", toUserUuid: t.executorUuid, note: `Регламентная задача по расписанию «${st.name}»` });
			if (t.executorUuid) await notifyUser(t.executorUuid, { kind: "regulation", title: `Регламентная задача: ${st.name}`, link: { endpoint: "todos", uuid: todo.uuid }, organizationUuid: t.organizationUuid, dedupKey: `regulation:${todo.uuid}` });
			created++;
		}
	}
	return created ? `регламентных задач: ${created}` : undefined;
}

/**
 * Посещаемость (пп. 32–34): по каждому графику — последние дни (заявки согласуют не сразу).
 * Кандидат заводится один на сотрудника и день (ruleKey), решение главбуха не пересматривается.
 */
export async function runAttendanceJob(now = new Date()) {
	const schedules = await prisma.workSchedule.findMany({ where: { deletedAt: null, isActive: true } });
	const dayKind = schedules.length ? await getDayKind() : null;
	let created = 0;
	for (const sch of schedules) {
		const settings = await getQualitySettings(sch.organizationUuid);
		const offset = settings.tzOffsetMinutes;
		const today = localParts(now, offset).ymd;
		const days = Array.from({ length: settings.attendance.evaluateDaysBack + 1 }, (_, i) => addDaysYmd(today, -i));
		const [marks, requests] = await Promise.all([
			prisma.workDayMark.findMany({ where: { organizationUuid: sch.organizationUuid, userUuid: sch.userUuid, date: { in: days } } }),
			prisma.absenceRequest.findMany({ where: { organizationUuid: sch.organizationUuid, userUuid: sch.userUuid, deletedAt: null, dateTo: { gte: days[days.length - 1] }, dateFrom: { lte: today } } }),
		]);
		for (const ymd of days) {
			const verdict = evaluateDay({ schedule: sch, ymd, mark: marks.find((m) => m.date === ymd) || null, requests, now, offsetMinutes: offset, dayKind });
			if (verdict.verdict !== "violation") continue;
			const c = await createCandidate({
				userUuid: sch.userUuid, itemNumber: verdict.item, rule: `attendance_${verdict.rule}`,
				ruleKey: `attendance:${sch.userUuid}:${ymd}`, firmOrgUuid: sch.organizationUuid,
				description: verdict.description, occurredAt: new Date(`${ymd}T12:00:00Z`),
				evidence: [{ kind: "attendance", date: ymd }],
			});
			if (c) created++;
		}
	}
	return created ? `кандидатов по посещаемости: ${created}` : undefined;
}

/** Для отчётов и тестов: имена по uuid. */
export { userNames, firmOrgForUser };

export default { runSlaJob, runScheduledTasks, runAttendanceJob };

/**
 * Однократное объявление о новых правилах задач (E17, 25.09). После выпуска задача закрывается только
 * с результатом, а у обращений клиента появился срок реакции — это меняет привычную работу всех, кто
 * ведёт задачи, и узнать об этом из отказа «нужен результат» — плохой способ. Уведомление получают те,
 * кто за последние 90 дней был исполнителем или куратором задач, и сотрудники групп. Флаг в AppSetting
 * делает рассылку однократной, уникальный dedupKey — безопасной при гонке процессов.
 */
export const ANNOUNCE_KEY = "quality.announce.tasks-2026-09-25";

export async function runAnnouncement(now = new Date()) {
	// Как и остальные правила стандарта — только после назначения организации-фирмы (Н6 аудита 26.09):
	// иначе объявление о правилах уходило бы на установке, где учёт качества не включён, и флаг
	// «уже объявлено» съедал бы рассылку к моменту, когда стандарт действительно введут.
	if (!(await getFirmOrgSetting())) return undefined;
	const done = await prisma.appSetting.findUnique({ where: { key: ANNOUNCE_KEY }, select: { value: true } });
	if (done?.value) return undefined;
	const since = new Date(now.getTime() - 90 * DAY);
	const [tasks, members, groups] = await Promise.all([
		prisma.todo.findMany({ where: { deletedAt: null, updatedAt: { gte: since } }, select: { executorUuid: true, curatorUuid: true, organizationUuid: true } }),
		prisma.staffGroupMember.findMany({ select: { userUuid: true } }),
		prisma.staffGroup.findMany({ where: { deletedAt: null }, select: { headUuid: true, managerUuid: true, organizationUuid: true } }),
	]);
	const users = new Map();
	for (const t of tasks) for (const u of [t.executorUuid, t.curatorUuid]) if (u && !users.has(u)) users.set(u, t.organizationUuid);
	for (const m of members) if (!users.has(m.userUuid)) users.set(m.userUuid, null);
	for (const g of groups) for (const u of [g.headUuid, g.managerUuid]) if (u && !users.has(u)) users.set(u, g.organizationUuid);
	let sent = 0;
	for (const [userUuid, organizationUuid] of users) {
		const n = await notifyUser(userUuid, {
			kind: "announcement",
			title: "Новое в задачах: закрывать с результатом",
			body: "Задачу теперь закрывают только с конкретным результатом — что сделано и чем закончилось («написала», «позвонила», «передала» не принимаются). У обращений клиента есть срок реакции: кнопка «Принять в работу». Если не получается — «Нужна помощь», это не нарушение. Статусы «Ждём клиента/контрагента» требуют даты контроля. Подробнее — раздел «CRM → Качество».",
			organizationUuid,
			dedupKey: `${ANNOUNCE_KEY}:${userUuid}`,
			telegram: false,
		});
		if (n) sent++;
	}
	await prisma.appSetting.upsert({ where: { key: ANNOUNCE_KEY }, create: { key: ANNOUNCE_KEY, value: now.toISOString() }, update: { value: now.toISOString() } });
	return `объявление о правилах задач: ${sent}`;
}
