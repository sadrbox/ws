// Проверки учёта в базах 1С клиентов (E17 СК2) — приём итогов ночного прогона из сервиса ai.
//
// Поток: ai прогоняет RUN_ACCOUNTING_CHECK / GET_ACCOUNTING_SNAPSHOT через бизнес-агента и
// присылает всё разом (POST /bpai/checks/results). Здесь:
//   1. прогон записывается (check_runs);
//   2. находки сводятся по fingerprint (check_findings): новая / та же / устранена / вернулась;
//   3. по каждой проверке с открытыми находками у клиента — ОДНА сводная задача ответственному
//      (двести задач «дубль номенклатуры» никому не нужны); находки ушли — задачу закрывает
//      прогон, а не исполнитель: «исправил» подтверждает база;
//   4. находка вернулась вскоре после устранения — кандидат по п. 5 (нет контроля исправления);
//   5. новые находки проверяются против отмеченных чек-листов — п. 27/28 (checklists.js).
// Кандидаты по просроченным находкам заводит периодическое правило (jobs.js): срок идёт и без
// новых прогонов.
import { prisma } from "../../prisma/prisma-client.js";
import { getQualitySettings, getFirmOrgSetting } from "./settings.js";
import { normalizeFinding, planFindingsSync, checkTitle, compareFindings, exceptionActive, standardItemFor, findingDeadlineDays, compareKn } from "./findingRules.js";
import { responsibleForClient, firmOrgForUser, groupOfClient, orgNames } from "./access.js";
import { getWorkOptions } from "./calendar.js";
import { addWorkingDays } from "./workTime.js";
import { createCandidate } from "./violations.js";
import { notifyUser, notifyMany } from "./notify.js";
import { loadStatuses, doneStatus, logEvent } from "./todos.js";
import { detectSelfCheckViolations } from "./checklists.js";

const asDate = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null);

/**
 * Принять итоги прогона по одной организации.
 * @param {string} organizationUuid — клиент (по БИН из тела, резолвит роутер)
 * @param {object} body — { baseKey, runs:[{check, scope, request, ok, data|error}], snapshots:[…] }
 */
export async function ingestCheckResults(organizationUuid, body) {
	const firm = await getFirmOrgSetting();
	const settings = await getQualitySettings(firm);
	const counters = { runs: 0, findingsNew: 0, findingsSeen: 0, findingsResolved: 0, findingsReopened: 0, rejected: 0, snapshots: 0, tasksOpened: 0, tasksClosed: 0 };
	const touched = new Set();

	for (const run of Array.isArray(body?.runs) ? body.runs : []) {
		const check = String(run?.check || run?.data?.check || "").trim();
		if (!check) continue;
		const req = run.request || {};
		const data = run.ok ? run.data || {} : null;
		const status = run.ok ? (["ok", "findings", "skipped"].includes(data.status) ? data.status : "findings") : "error";
		// Повторная доставка той же посылки (ai повторяет отправку после сетевого сбоя): ответ
		// 1С с тем же моментом чтения уже принят — второй прогон и второй раунд находок не нужны.
		const readAt = asDate(data?.readAt);
		if (readAt && (await prisma.checkRun.findFirst({ where: { organizationUuid, checkCode: check, readAt }, select: { id: true } }))) {
			counters.duplicates = (counters.duplicates || 0) + 1;
			continue;
		}
		const checkRun = await prisma.checkRun.create({
			data: {
				organizationUuid,
				baseKey: body.baseKey || null,
				checkCode: check,
				checkVersion: Number.isInteger(data?.version) ? data.version : null,
				scope: run.scope || null,
				status,
				truncated: !!data?.truncated,
				total: Number.isFinite(data?.total) ? data.total : Array.isArray(data?.findings) ? data.findings.length : 0,
				summary: data?.summary ?? undefined,
				params: data?.params ?? req.params ?? undefined,
				periodFrom: asDate(data?.from ?? req.from),
				periodTo: asDate(data?.to ?? req.to),
				onDate: asDate(data?.onDate ?? req.onDate),
				errorCode: run.ok ? null : String(run.error?.code || "ERROR").slice(0, 100),
				errorMessage: run.ok ? null : String(run.error?.message || "").slice(0, 2000),
				skipReason: data?.skipReason ? String(data.skipReason).slice(0, 1000) : null,
				durationMs: Number.isFinite(data?.durationMs) ? Math.round(data.durationMs) : null,
				readAt,
			},
		});
		counters.runs++;
		if (!run.ok || status === "skipped") continue;

		// Находки: нормализуем, отбрасывая кривые строки поштучно.
		const incoming = [];
		for (const raw of Array.isArray(data.findings) ? data.findings : []) {
			const n = normalizeFinding(raw);
			if (n.ok) incoming.push(n.value);
			else counters.rejected++;
		}
		const existing = await prisma.checkFinding.findMany({
			where: { organizationUuid, checkCode: check },
			select: { uuid: true, fingerprint: true, resolvedAt: true, firstSeenAt: true },
		});
		const plan = planFindingsSync({ existing, incoming, complete: !data.truncated });
		const now = new Date();
		const created = [];
		for (const f of plan.create) {
			try {
				created.push(await prisma.checkFinding.create({
					data: { organizationUuid, checkCode: check, fingerprint: f.fingerprint, severity: f.severity, title: f.title, factDate: f.factDate, amount: f.amount, data: f.data, firstSeenAt: now, lastSeenAt: now, lastRunUuid: checkRun.uuid },
				}));
				counters.findingsNew++;
			} catch (e) {
				if (e?.code !== "P2002") throw e; // гонка двух приёмов — вторая уже записала
			}
		}
		const exByUuid = new Map(existing.map((e) => [e.uuid, e]));
		for (const u of plan.update) {
			const ex = exByUuid.get(u.uuid);
			const updated = await prisma.checkFinding.update({
				where: { uuid: u.uuid },
				data: {
					severity: u.value.severity, title: u.value.title, factDate: u.value.factDate, amount: u.value.amount, data: u.value.data,
					lastSeenAt: now, lastRunUuid: checkRun.uuid,
					...(u.reopened ? { resolvedAt: null, reopenedCount: { increment: 1 }, candidateAt: null } : {}),
				},
			});
			counters.findingsSeen++;
			if (u.reopened) {
				counters.findingsReopened++;
				await onFindingReopened(updated, ex, settings);
			}
		}
		if (plan.resolve.length) {
			const r = await prisma.checkFinding.updateMany({ where: { uuid: { in: plan.resolve } }, data: { resolvedAt: now } });
			counters.findingsResolved += r.count;
		}
		touched.add(check);
		if (created.length) await detectSelfCheckViolations(organizationUuid, check, created);
	}

	for (const snap of Array.isArray(body?.snapshots) ? body.snapshots : []) {
		if (!snap?.ok || !snap.data) continue;
		const d = snap.data;
		const code = String(snap.snapshot || d.snapshot || "unknown").slice(0, 60);
		const snapReadAt = asDate(d.readAt);
		const periodFrom = asDate(d.from ?? snap.request?.from);
		if (snapReadAt && (await prisma.accountingSnapshot.findFirst({ where: { organizationUuid, code, readAt: snapReadAt, periodFrom }, select: { id: true } }))) {
			counters.duplicates = (counters.duplicates || 0) + 1;
			continue;
		}
		await prisma.accountingSnapshot.create({
			data: {
				organizationUuid,
				code,
				baseKey: body.baseKey || null,
				periodFrom,
				periodTo: asDate(d.to ?? snap.request?.to),
				onDate: asDate(d.onDate ?? snap.request?.onDate),
				rows: Array.isArray(d.rows) ? d.rows : [],
				readAt: asDate(d.readAt),
			},
		});
		counters.snapshots++;
	}

	for (const check of touched) {
		const r = await syncSummaryTask(organizationUuid, check, settings);
		if (r === "opened") counters.tasksOpened++;
		if (r === "closed") counters.tasksClosed++;
	}
	return counters;
}

/**
 * Находка вернулась после устранения. В окне `reopenWindowDays` — кандидат по п. 5
 * ответственному за клиента: «передать на исправление мало — нужно убедиться, что устранено».
 */
async function onFindingReopened(finding, before, settings) {
	const windowDays = settings.errorControl.reopenWindowDays;
	const resolvedAt = before?.resolvedAt ? new Date(before.resolvedAt) : null;
	if (!resolvedAt || Date.now() - resolvedAt.getTime() > windowDays * 86_400_000) return;
	if (finding.severity === "info" || exceptionActive(finding)) return;
	const responsible = await responsibleForClient(finding.organizationUuid);
	if (!responsible) return;
	await createCandidate({
		userUuid: responsible, itemNumber: 5, rule: "finding_reopened",
		ruleKey: `finding_reopened:${finding.uuid}:${resolvedAt.toISOString()}`,
		clientOrganizationUuid: finding.organizationUuid,
		description: `Находка «${finding.title}» (${checkTitle(finding.checkCode)}) вернулась через ${Math.max(1, Math.round((Date.now() - resolvedAt.getTime()) / 86_400_000))} дн. после устранения`,
		evidence: [{ kind: "finding", uuid: finding.uuid, label: finding.title, checkCode: finding.checkCode }],
	});
}

/** Открытые находки проверки у клиента, без действующих исключений. */
async function openFindings(organizationUuid, checkCode) {
	const rows = await prisma.checkFinding.findMany({ where: { organizationUuid, checkCode, resolvedAt: null } });
	return rows.filter((f) => !exceptionActive(f) && f.severity !== "info");
}

/**
 * Сводная задача по проверке у клиента: открыть/обновить, если есть открытые находки,
 * закрыть — если их больше нет. Возвращает "opened" | "updated" | "closed" | null.
 */
export async function syncSummaryTask(organizationUuid, checkCode, settings = null) {
	const s = settings ?? (await getQualitySettings(await getFirmOrgSetting()));
	const statuses = await loadStatuses();
	const finals = statuses.filter((st) => st.isFinal).map((st) => st.code);
	const open = (await openFindings(organizationUuid, checkCode)).sort(compareFindings);
	const task = await prisma.todo.findFirst({
		where: { organizationUuid, kind: "check_finding", checkCode, deletedAt: null, status: { notIn: finals.length ? finals : ["done"] } },
		orderBy: { id: "desc" },
	});
	const title = checkTitle(checkCode);
	if (!open.length) {
		if (!task) return null;
		const now = new Date();
		const done = doneStatus(statuses);
		await prisma.todo.update({
			where: { uuid: task.uuid },
			data: { status: done, completedAt: now, result: `Находки устранены — подтверждено прогоном проверки ${now.toISOString().slice(0, 10)}`, lastActivityAt: now },
		});
		await logEvent(task.uuid, { type: "status", channel: "system", note: "Закрыта прогоном: находок больше нет", payload: { from: task.status, to: done } });
		await prisma.checkFinding.updateMany({ where: { todoUuid: task.uuid }, data: { todoUuid: null } });
		return "closed";
	}
	const errors = open.filter((f) => f.severity === "error").length;
	const lines = open.slice(0, 20).map((f) => `• ${f.severity === "error" ? "❗" : "⚠"} ${f.title}`);
	if (open.length > 20) lines.push(`… и ещё ${open.length - 20}`);
	const description = `Проверка учёта в базе 1С «${title}»: открыто находок — ${open.length} (ошибок — ${errors}).\n${lines.join("\n")}\n\nЗадача закроется сама, когда следующий прогон не найдёт этих находок. Если находка — осознанное решение (например, ОС используется дальше), главбух ставит по ней исключение с причиной.`;
	const earliest = open.reduce((m, f) => (f.firstSeenAt < m ? f.firstSeenAt : m), open[0].firstSeenAt);
	// Срок отработки — в рабочих днях: находка, пришедшая ночью на субботу, не «горит» за выходные.
	const work = await getWorkOptions(s);
	const days = findingDeadlineDays(checkCode, s);
	const deadline = work ? addWorkingDays(earliest, days, work) : new Date(new Date(earliest).getTime() + days * 86_400_000);
	if (task) {
		await prisma.todo.update({ where: { uuid: task.uuid }, data: { description, name: `${title}: ${open.length} находок` } });
		await prisma.checkFinding.updateMany({ where: { uuid: { in: open.map((f) => f.uuid) } }, data: { todoUuid: task.uuid } });
		return "updated";
	}
	const executor = await responsibleForClient(organizationUuid);
	const now = new Date();
	const created = await prisma.todo.create({
		data: {
			name: `${title}: ${open.length} находок`,
			description,
			organizationUuid,
			executorUuid: executor,
			deadline,
			kind: "check_finding",
			checkCode,
			priority: errors ? "high" : "normal",
			lastActivityAt: now,
			origin: "accounting-checks",
			originLabel: "Проверка учёта 1С",
		},
	});
	await prisma.checkFinding.updateMany({ where: { uuid: { in: open.map((f) => f.uuid) } }, data: { todoUuid: created.uuid } });
	await logEvent(created.uuid, { type: "created", channel: "system", toUserUuid: executor, note: `Проверка «${title}»` });
	if (executor) {
		await notifyUser(executor, {
			kind: "check_finding",
			title: `Проверка учёта: ${title} — ${open.length} находок`,
			link: { endpoint: "todos", uuid: created.uuid },
			organizationUuid,
			dedupKey: `check-task:${created.uuid}`,
		});
	} else {
		await notifyNoResponsible(organizationUuid, created.uuid);
	}
	return "opened";
}

/**
 * Кандидаты по просроченным находкам (периодически): находка с важностью error открыта дольше
 * срока отработки и не под исключением — кандидат ответственному, пункт — по проверке.
 */
export async function runFindingCandidates(now = new Date()) {
	const firm = await getFirmOrgSetting();
	if (!firm) return undefined; // учёт качества не включён — см. runSlaJob
	const settings = await getQualitySettings(firm);
	const rows = await prisma.checkFinding.findMany({
		where: { resolvedAt: null, candidateAt: null, severity: "error" },
		take: 2000,
		orderBy: { firstSeenAt: "asc" },
	});
	const work = await getWorkOptions(settings);
	let created = 0;
	for (const f of rows) {
		if (exceptionActive(f, now)) continue;
		const days = findingDeadlineDays(f.checkCode, settings);
		const due = work ? addWorkingDays(f.firstSeenAt, days, work) : new Date(new Date(f.firstSeenAt).getTime() + days * 86_400_000);
		if (now.getTime() < due.getTime()) continue;
		const item = standardItemFor(f.checkCode, f);
		if (!item) continue;
		const responsible = await responsibleForClient(f.organizationUuid);
		// Ответственного нет — кандидата некому адресовать (нарушение без нарушителя не бывает). Главбух
		// группы (или администратор) получает сигнал назначить ответственного; правило вернётся к
		// находке на следующем круге, когда он появится.
		if (!responsible) {
			await notifyNoResponsible(f.organizationUuid, f.todoUuid);
			continue;
		}
		const c = await createCandidate({
			userUuid: responsible, itemNumber: item, rule: "finding_overdue", ruleKey: `finding:${f.uuid}`,
			firmOrgUuid: await firmOrgForUser(responsible),
			clientOrganizationUuid: f.organizationUuid,
			occurredAt: new Date(new Date(f.firstSeenAt).getTime() + days * 86_400_000),
			description: `Не отработана за ${days} дн. находка проверки учёта «${checkTitle(f.checkCode)}»: ${f.title}`,
			evidence: [{ kind: "finding", uuid: f.uuid, label: f.title, checkCode: f.checkCode, todoUuid: f.todoUuid }],
		});
		await prisma.checkFinding.update({ where: { uuid: f.uuid }, data: { candidateAt: now } });
		if (c) created++;
	}
	return created ? `кандидатов по находкам: ${created}` : undefined;
}

/**
 * У клиента нет ответственного бухгалтера — задачи по находкам некому ставить. Сигнал главбуху группы
 * клиента, а если клиент ни в одной группе — администраторам фирмы. Раз в сутки на клиента.
 */
async function notifyNoResponsible(organizationUuid, todoUuid = null) {
	const group = await groupOfClient(organizationUuid);
	let to = group?.headUuid ? [group.headUuid] : [];
	if (!to.length) {
		const firm = await getFirmOrgSetting();
		if (firm) to = (await prisma.accessRight.findMany({ where: { organizationUuid: firm, role: "admin" }, select: { userUuid: true } })).map((a) => a.userUuid);
	}
	if (!to.length) return;
	const name = (await orgNames([organizationUuid])).get(organizationUuid) ?? "клиент";
	const day = new Date().toISOString().slice(0, 10);
	await notifyMany(to, {
		kind: "no_responsible",
		title: `Нет ответственного бухгалтера: ${name}`,
		body: group
			? "Проверки учёта нашли ошибки, но задачу некому поставить. Назначьте ответственного в «Группах сотрудников»."
			: "Клиент не входит ни в одну группу сотрудников: добавьте его в группу и назначьте ответственного.",
		link: todoUuid ? { endpoint: "todos", uuid: todoUuid } : { pane: "StaffGroupsList" },
		organizationUuid,
		dedupKey: `no-responsible:${organizationUuid}:${day}`,
	});
}

/** Исключение по находке: осознанное решение главбуха с причиной и сроком. */
export async function setFindingException(finding, { reason, until = null, userUuid }) {
	const text = String(reason || "").trim();
	if (text.length < 5) return { error: "Укажите причину решения (не короче 5 знаков)" };
	const untilDate = until ? new Date(until) : null;
	if (untilDate && Number.isNaN(untilDate.getTime())) return { error: "Некорректный срок исключения" };
	const item = await prisma.checkFinding.update({
		where: { uuid: finding.uuid },
		data: { exceptionReason: text, exceptionByUuid: userUuid, exceptionAt: new Date(), exceptionUntil: untilDate },
	});
	await syncSummaryTask(finding.organizationUuid, finding.checkCode);
	return { item };
}

export async function clearFindingException(finding) {
	const item = await prisma.checkFinding.update({
		where: { uuid: finding.uuid },
		data: { exceptionReason: null, exceptionByUuid: null, exceptionAt: null, exceptionUntil: null },
	});
	await syncSummaryTask(finding.organizationUuid, finding.checkCode);
	return { item };
}

export { compareKn };

export default { ingestCheckResults, syncSummaryTask, runFindingCandidates, setFindingException, clearFindingException, compareKn };
