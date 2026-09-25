// Панели главбуха и руководителя (E17 СК4), динамика первички (СК3.4), выборка консультаций
// (СК7.3). Только чтение.
import { prisma } from "../../prisma/prisma-client.js";
import { AREAS, areaOf, areaState, exceptionActive } from "./findingRules.js";
import { computeBonusResults, windowMonths } from "./bonusRules.js";
import { reviewConsultation } from "./consultationRules.js";
import { getQualitySettings } from "./settings.js";
import { userNames, orgNames } from "./access.js";
import { loadStatuses } from "./todos.js";
import { addMonths, localParts, localToUtc, monthBounds } from "./time.js";

const DAY = 86_400_000;

/**
 * Панель главбуха: клиенты групп × участки. Главбух обязан видеть состояние сверок,
 * задолженности, банка, документов, налогов, ТМЗ, ОС, поручений клиентов и сроков (п. 29).
 */
export async function chiefDashboard(ctx, { groupUuid = null, now = new Date() } = {}) {
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const groups = ctx.groups.filter((g) => (groupUuid ? g.uuid === groupUuid : true) && (ctx.isAdmin || ctx.headGroupUuids.includes(g.uuid) || ctx.managerGroupUuids.includes(g.uuid)));
	const clients = [];
	for (const g of groups) for (const c of g.clients) clients.push({ ...c, groupName: g.name, groupUuid: g.uuid });
	const orgIds = [...new Set(clients.map((c) => c.clientOrganizationUuid))];
	if (!orgIds.length) return { areas: AREAS, clients: [], consultations: [] };

	const statuses = await loadStatuses();
	const finals = statuses.filter((s) => s.isFinal).map((s) => s.code);
	const [findings, runs, tasks, kn, receipts] = await Promise.all([
		prisma.checkFinding.findMany({ where: { organizationUuid: { in: orgIds }, resolvedAt: null }, select: { organizationUuid: true, checkCode: true, severity: true, exceptionAt: true, exceptionUntil: true } }),
		prisma.checkRun.groupBy({ by: ["organizationUuid"], where: { organizationUuid: { in: orgIds }, status: { not: "error" } }, _max: { createdAt: true } }),
		prisma.todo.findMany({ where: { organizationUuid: { in: orgIds }, deletedAt: null, status: { notIn: finals.length ? finals : ["done"] } }, select: { organizationUuid: true, kind: true, deadline: true, acceptedAt: true, reactionDueAt: true, checkCode: true } }),
		prisma.knStatement.findMany({ where: { organizationUuid: { in: orgIds }, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { organizationUuid: true, onDate: true, comparison: true } }),
		prisma.primaryDocsReceipt.findMany({ where: { organizationUuid: { in: orgIds }, deletedAt: null, month: addMonths(localParts(now, settings.tzOffsetMinutes).ym, -1) }, select: { organizationUuid: true, complete: true, receivedAt: true } }),
	]);
	const names = await orgNames(orgIds);
	const people = await userNames(clients.map((c) => c.responsibleUuid));
	const lastRun = new Map(runs.map((r) => [r.organizationUuid, r._max.createdAt]));
	// Последняя ошибка прогона по клиенту — если она новее последнего успешного, база «не проверена»:
	// агент не ответил, нет каталога проверок или агент их не умеет (сервис ai шлёт `_catalog`).
	const errors = await prisma.checkRun.findMany({
		where: { organizationUuid: { in: orgIds }, status: "error", createdAt: { gte: new Date(now.getTime() - 14 * DAY) } },
		orderBy: { createdAt: "desc" },
		select: { organizationUuid: true, checkCode: true, errorCode: true, errorMessage: true, createdAt: true },
		take: 2000,
	});
	const lastError = new Map();
	for (const e of errors) if (!lastError.has(e.organizationUuid)) lastError.set(e.organizationUuid, e);
	const latestKn = new Map();
	for (const k of kn) if (!latestKn.has(k.organizationUuid)) latestKn.set(k.organizationUuid, k);

	const rows = clients.map((c) => {
		const org = c.clientOrganizationUuid;
		const areaAgg = Object.fromEntries(AREAS.map((a) => [a, { errors: 0, warnings: 0, overdue: 0, openTasks: 0 }]));
		for (const f of findings) {
			if (f.organizationUuid !== org || f.severity === "info" || exceptionActive(f, now)) continue;
			const a = areaAgg[areaOf(f.checkCode)];
			if (f.severity === "error") a.errors++;
			else a.warnings++;
		}
		const orgTasks = tasks.filter((t) => t.organizationUuid === org);
		for (const t of orgTasks.filter((x) => x.kind === "check_finding" && x.checkCode)) {
			const a = areaAgg[areaOf(t.checkCode)];
			a.openTasks++;
			if (t.deadline && t.deadline < now) a.overdue++;
		}
		const k = latestKn.get(org);
		if (k?.comparison?.mismatches) areaAgg.taxes.errors += k.comparison.mismatches;
		const hasData = lastRun.has(org);
		const areas = Object.fromEntries(AREAS.map((a) => [a, { ...areaAgg[a], state: areaState({ ...areaAgg[a], hasData: hasData || (a === "taxes" && !!k) }) }]));
		const requests = orgTasks.filter((t) => t.kind === "client_request");
		const overdue = orgTasks.filter((t) => t.deadline && t.deadline < now).length;
		const receipt = receipts.find((r) => r.organizationUuid === org) || null;
		return {
			organizationUuid: org,
			name: names.get(org) ?? org,
			groupUuid: c.groupUuid,
			groupName: c.groupName,
			responsibleUuid: c.responsibleUuid,
			responsibleName: people.get(c.responsibleUuid) ?? null,
			lastRunAt: lastRun.get(org) ?? null,
			runStatus: runStatusOf(lastRun.get(org) ?? null, lastError.get(org) ?? null, now),
			areas,
			requests: {
				open: requests.length,
				unaccepted: requests.filter((t) => !t.acceptedAt).length,
				overdueReaction: requests.filter((t) => !t.acceptedAt && t.reactionDueAt && t.reactionDueAt < now).length,
				state: areaState({ errors: requests.filter((t) => !t.acceptedAt && t.reactionDueAt && t.reactionDueAt < now).length, openTasks: requests.length }),
			},
			deadlines: { overdue, open: orgTasks.length, state: areaState({ overdue, openTasks: 0 }) },
			primaryDocs: receipt ? { received: true, complete: receipt.complete, receivedAt: receipt.receivedAt } : { received: false },
			kn: k ? { onDate: k.onDate, mismatches: k.comparison?.mismatches ?? null } : null,
		};
	});
	rows.sort((a, b) => a.groupName.localeCompare(b.groupName, "ru") || a.name.localeCompare(b.name, "ru"));
	return { areas: AREAS, clients: rows, consultations: await consultationsForReview(orgIds, settings, now) };
}

/**
 * Состояние проверок учёта клиента на панели: ok — свежий успешный прогон; stale — успешного не было
 * дольше двух суток; error — последний прогон упал; unavailable — агент или расширение не умеют
 * проверки (обновить); access — у пользователя API в базе нет прав на чтение (дать права);
 * never — прогонов не было.
 *
 * `access` отдельно от `error` по просьбе стороны 1С (ответ 25.09, раздел 7а): права расширение
 * проверяет ДО запроса и отвечает ACCESS_DENIED с именем объекта, которого не хватает. Это дело
 * администратора базы клиента, а не сбой расширения, — и без прав база только выглядела бы чистой.
 */
export function runStatusOf(lastOkAt, lastErr, now = new Date()) {
	const okAt = lastOkAt ? new Date(lastOkAt).getTime() : 0;
	const errNewer = lastErr && new Date(lastErr.createdAt).getTime() > okAt;
	if (errNewer) {
		const unavailable = lastErr.errorCode === "CAPABILITY_MISSING" || lastErr.errorCode === "UNKNOWN_COMMAND";
		const state = unavailable ? "unavailable" : lastErr.errorCode === "ACCESS_DENIED" ? "access" : "error";
		return { state, code: lastErr.errorCode, message: lastErr.errorMessage, at: lastErr.createdAt, check: lastErr.checkCode };
	}
	if (!okAt) return { state: "never" };
	if (now.getTime() - okAt > 2 * DAY) return { state: "stale", at: lastOkAt };
	return { state: "ok", at: lastOkAt };
}

/**
 * Выборка консультаций для главбуха (СК7.3): закрытые за 30 дней обращения с низкой оценкой
 * клиента или с ответом, которому эвристика не нашла вывода либо который длиннее нормы.
 */
export async function consultationsForReview(orgIds, settings, now = new Date()) {
	const rows = await prisma.todo.findMany({
		where: { organizationUuid: { in: orgIds }, kind: "client_request", deletedAt: null, completedAt: { gte: new Date(now.getTime() - 30 * DAY) } },
		select: { uuid: true, id: true, name: true, result: true, clientRating: true, executorUuid: true, organizationUuid: true, completedAt: true },
		orderBy: { completedAt: "desc" },
		take: 300,
	});
	const out = [];
	for (const t of rows) {
		const review = t.result ? reviewConsultation(t.result, { maxLength: settings.consultation.maxLength }) : null;
		const lowRating = t.clientRating !== null && t.clientRating <= 2;
		const weak = review && (!review.checks.conclusion || !review.checks.length || !review.checks.notLawDump);
		if (lowRating || weak) out.push({ ...t, reasons: [...(lowRating ? [`оценка клиента ${t.clientRating}`] : []), ...(review?.suggestions?.slice(0, 2) ?? [])] });
		if (out.length >= 20) break;
	}
	const names = await userNames(out.map((t) => t.executorUuid));
	return out.map((t) => ({ ...t, executorName: names.get(t.executorUuid) ?? null }));
}

/**
 * Панель руководителя: группы и сотрудники — кандидаты, подтверждённые нарушения месяца,
 * повторяемость и «мер нет» (п. 30).
 */
export async function managerDashboard(ctx, { month }) {
	const settings = await getQualitySettings(ctx.firmOrgUuid);
	const groups = ctx.groups.filter((g) => ctx.isAdmin || ctx.managerGroupUuids.includes(g.uuid) || ctx.headGroupUuids.includes(g.uuid));
	const staff = [];
	for (const g of groups) {
		if (g.headUuid) staff.push({ userUuid: g.headUuid, groupName: g.name, groupUuid: g.uuid, role: "chief" });
		for (const m of g.members) if (m.userUuid !== g.headUuid) staff.push({ userUuid: m.userUuid, groupName: g.name, groupUuid: g.uuid, role: "member" });
	}
	const uids = [...new Set(staff.map((s) => s.userUuid))];
	const months = windowMonths(month, settings.violations.systematicMonths);
	const [violations, measures, names] = await Promise.all([
		prisma.standardViolation.findMany({ where: { organizationUuid: ctx.firmOrgUuid, userUuid: { in: uids }, deletedAt: null, bonusMonth: { in: months } } }),
		prisma.violationMeasure.findMany({ where: { organizationUuid: ctx.firmOrgUuid, userUuid: { in: uids }, deletedAt: null } }),
		userNames(uids),
	]);
	const results = computeBonusResults({ month, staff: staff.map((s) => ({ ...s, userName: names.get(s.userUuid) })), violations, measures, settings });
	const byUser = new Map(results.map((r) => [r.userUuid, r]));
	return {
		month,
		groups: groups.map((g) => {
			const rows = staff.filter((s) => s.groupUuid === g.uuid).map((s) => ({ ...byUser.get(s.userUuid), role: s.role }));
			return {
				uuid: g.uuid,
				name: g.name,
				headName: names.get(g.headUuid) ?? null,
				staff: rows,
				totals: {
					withoutBonus: rows.filter((r) => !r.bonus).length,
					candidates: rows.reduce((s, r) => s + (r.pendingCandidates || 0), 0),
					systematic: rows.filter((r) => r.systematic).length,
					noMeasure: rows.filter((r) => r.noMeasure).length,
				},
			};
		}),
	};
}

/**
 * Динамика ввода первички за месяц (п. 19) по ночным снимкам `documents` из 1С: сколько
 * документов месяца было в базе на каждую ночь и какая доля внесена в последние дни перед
 * сроком отчётности. ПРОВЕРИТЬ ПОТОМ: срок (reportDay) и окно (lateWindowDays) — умолчания.
 */
export async function primaryDocsDynamics(organizationUuid, month, settings) {
	const offset = settings.tzOffsetMinutes;
	const { from } = monthBounds(month, offset);
	const snaps = await prisma.accountingSnapshot.findMany({
		where: { organizationUuid, code: "documents", periodFrom: { gte: new Date(from.getTime() - DAY), lte: new Date(from.getTime() + DAY) } },
		orderBy: { createdAt: "asc" },
		select: { createdAt: true, rows: true },
	});
	const series = snaps.map((s) => ({
		at: s.createdAt,
		count: (Array.isArray(s.rows) ? s.rows : []).reduce((sum, r) => sum + (Number(r?.count) || 0), 0),
	}));
	const deadline = localToUtc(`${addMonths(month, 1)}-${String(settings.primaryDocs.reportDay).padStart(2, "0")}`, 0, offset);
	const windowStart = new Date(deadline.getTime() - settings.primaryDocs.lateWindowDays * DAY);
	const countAt = (t) => {
		let c = null;
		for (const p of series) if (p.at.getTime() <= t.getTime()) c = p.count;
		return c;
	};
	const atDeadline = countAt(deadline) ?? series[series.length - 1]?.count ?? null;
	const beforeWindow = countAt(windowStart);
	const lateShare = atDeadline && beforeWindow !== null ? Math.max(0, (atDeadline - beforeWindow) / atDeadline) : null;
	return {
		month,
		deadline,
		windowStart,
		series,
		lateShare,
		signal: lateShare !== null && lateShare >= settings.primaryDocs.lateShareThreshold,
	};
}

export default { chiefDashboard, managerDashboard, primaryDocsDynamics, consultationsForReview };
