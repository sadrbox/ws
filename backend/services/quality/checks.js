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
import { responsibleForClient, firmOrgForUser, groupOfClient, orgNames, loadGroups } from "./access.js";
import { getWorkOptions } from "./calendar.js";
import { addWorkingDays } from "./workTime.js";
import { createCandidate } from "./violations.js";
import { notifyUser, notifyMany } from "./notify.js";
import { loadStatuses, doneStatus, logEvent } from "./todos.js";
import { detectSelfCheckViolations } from "./checklists.js";
import { splitSeenUpdates, summaryWithNotes } from "./ingestPlan.js";
import { firmScope } from "./scope.js";
import { sentNotificationKeys, existingRuleKeys, manyKeys, freshRecipients } from "./dedupBatch.js";

const asDate = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null);
/** Находок на страницу в фоновом правиле (обход всех, а не первых N). */
const FINDINGS_PAGE = 500;

/*
 * ОЖИДАНИЕ БЛОКИРОВКИ ПРИЁМА — С ЯВНЫМ ПРЕДЕЛОМ (КР-15 аудита 27.09). Вторая посылка той же проверки
 * того же клиента (другая база организации, повтор ai) ждёт первую под pg_advisory_xact_lock. Предела
 * у ожидания не было, и его обрывал общий statement_timeout пула (30 с): 57014, откат, «Ошибка
 * сервера». Теперь ждём не дольше INGEST_LOCK_WAIT_MS (SET LOCAL lock_timeout — только в этой
 * транзакции; меньше statement_timeout, чтобы сработал именно он) и отвечаем понятным отказом
 * CheckIngestBusyError: «приём этой проверки уже идёт — повторите позже». Ответ 503 — временный:
 * ключ идемпотентности посылки освобождается, повтор примет итоги.
 */
export const INGEST_LOCK_WAIT_MS = 20_000;

export class CheckIngestBusyError extends Error {
	constructor(check) {
		super(`Итоги проверки «${check}» по этой организации сейчас принимает другой запрос — повторите позже`);
		this.name = "CheckIngestBusyError";
		this.status = 503;
		this.code = "CHECK_INGEST_BUSY";
	}
}

/** Код SQLSTATE ошибки Postgres — в обёртке Prisma (P2010 + driverAdapterError) или как есть. */
function pgCodeOf(e) {
	const cause = e?.meta?.driverAdapterError?.cause;
	return cause?.originalCode ?? cause?.code ?? e?.meta?.code ?? (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : null);
}

/**
 * Взять блокировку приёма (клиент, проверка) в транзакции tx, ожидая не дольше waitMs.
 * Не дождались (lock_timeout 55P03, или statement_timeout 57014, если его задали короче) — CheckIngestBusyError.
 */
export async function lockCheckIngest(tx, organizationUuid, check, waitMs = INGEST_LOCK_WAIT_MS) {
	// SET не принимает параметров — подставляем целое число сами.
	await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${Math.max(1, Math.trunc(Number(waitMs) || INGEST_LOCK_WAIT_MS))}`);
	try {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`check-ingest:${organizationUuid}:${check}`}))`;
	} catch (e) {
		const code = pgCodeOf(e);
		if (code === "55P03" || code === "57014") throw new CheckIngestBusyError(check);
		throw e;
	}
}

/**
 * Принять итоги прогона по одной организации.
 * @param {string} organizationUuid — клиент (по БИН из тела, резолвит роутер)
 * @param {object} body — { baseKey, runs:[{check, scope, request, ok, data|error}], snapshots:[…] }
 * @param {{ lockWaitMs?: number }} [opts] — предел ожидания блокировки приёма проверки (тесты)
 */
export async function ingestCheckResults(organizationUuid, body, { lockWaitMs = INGEST_LOCK_WAIT_MS } = {}) {
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
		const readAt = asDate(data?.readAt);

		// Находки: нормализуем, отбрасывая кривые строки поштучно (до транзакции — это чистый расчёт).
		const incoming = [];
		if (run.ok && status !== "skipped") {
			for (const raw of Array.isArray(data.findings) ? data.findings : []) {
				const n = normalizeFinding(raw);
				if (n.ok) incoming.push(n.value);
				else counters.rejected++;
			}
		}

		/*
		 * ОДНА ПРОВЕРКА — ОДНА ТРАНЗАКЦИЯ (Н6 аудита 26.09). Прогон записывался до находок, а повтор
		 * посылки отсекался по readAt: сбой посреди приёма оставлял прогон «принятым», а находки —
		 * недосинхронизированными до следующей ночи (повтор ai отсекался как дубль). Теперь прогон,
		 * находки и их устранение фиксируются вместе или не фиксируются вовсе, и повтор примет всё
		 * заново. Две посылки одной проверки одного клиента разом (повтор ai после обрыва) идут друг
		 * за другом: транзакционная блокировка по (клиент, проверка), дубль отсекается под ней.
		 * Уведомления и кандидаты — после фиксации: откат не должен оставлять разосланного.
		 */
		const result = await prisma.$transaction(async (tx) => {
			await lockCheckIngest(tx, organizationUuid, check, lockWaitMs);
			if (readAt && (await tx.checkRun.findFirst({ where: { organizationUuid, checkCode: check, readAt }, select: { id: true } }))) {
				return { duplicate: true };
			}
			const checkRun = await tx.checkRun.create({
				data: {
					organizationUuid,
					baseKey: body.baseKey || null,
					checkCode: check,
					checkVersion: Number.isInteger(data?.version) ? data.version : null,
					scope: run.scope || null,
					status,
					truncated: !!data?.truncated,
					total: Number.isFinite(data?.total) ? data.total : Array.isArray(data?.findings) ? data.findings.length : 0,
					summary: summaryWithNotes(data?.summary, data?.notes),
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
			if (!run.ok || status === "skipped") return { synced: false };

			const existing = await tx.checkFinding.findMany({
				where: { organizationUuid, checkCode: check },
				select: { uuid: true, fingerprint: true, resolvedAt: true, firstSeenAt: true, severity: true, title: true, factDate: true, amount: true, data: true },
			});
			const plan = planFindingsSync({ existing, incoming, complete: !data.truncated });
			const now = new Date();
			// Новые — одним INSERT; уже существующая (гонка с другим приёмом) пропускается, а не роняет запрос.
			const created = plan.create.length
				? await tx.checkFinding.createManyAndReturn({
					data: plan.create.map((f) => ({ organizationUuid, checkCode: check, fingerprint: f.fingerprint, severity: f.severity, title: f.title, factDate: f.factDate, amount: f.amount, data: f.data, firstSeenAt: now, lastSeenAt: now, lastRunUuid: checkRun.uuid })),
					skipDuplicates: true,
				})
				: [];
			// Увиденные снова без изменений — одним UPDATE; целиком — только изменившиеся и вернувшиеся.
			const exByUuid = new Map(existing.map((e) => [e.uuid, e]));
			const { touch, full } = splitSeenUpdates(plan.update, exByUuid);
			if (touch.length) await tx.checkFinding.updateMany({ where: { uuid: { in: touch } }, data: { lastSeenAt: now, lastRunUuid: checkRun.uuid } });
			const reopened = [];
			for (const u of full) {
				const updated = await tx.checkFinding.update({
					where: { uuid: u.uuid },
					data: {
						severity: u.value.severity, title: u.value.title, factDate: u.value.factDate, amount: u.value.amount, data: u.value.data,
						lastSeenAt: now, lastRunUuid: checkRun.uuid,
						...(u.reopened ? { resolvedAt: null, reopenedCount: { increment: 1 }, candidateAt: null } : {}),
					},
				});
				if (u.reopened) reopened.push({ updated, before: exByUuid.get(u.uuid) });
			}
			const resolved = plan.resolve.length
				? (await tx.checkFinding.updateMany({ where: { uuid: { in: plan.resolve } }, data: { resolvedAt: now } })).count
				: 0;
			return { synced: true, created, seen: plan.update.length, reopened, resolved };
		}, { maxWait: 10_000, timeout: 60_000 });

		if (result.duplicate) {
			// Повторная доставка той же посылки (ai повторяет отправку после сетевого сбоя): ответ
			// 1С с тем же моментом чтения уже принят — второй прогон и второй раунд находок не нужны.
			counters.duplicates = (counters.duplicates || 0) + 1;
			continue;
		}
		counters.runs++;
		if (!result.synced) continue;
		counters.findingsNew += result.created.length;
		counters.findingsSeen += result.seen;
		counters.findingsReopened += result.reopened.length;
		counters.findingsResolved += result.resolved;
		for (const { updated, before } of result.reopened) await onFindingReopened(updated, before, settings);
		touched.add(check);
		if (result.created.length) await detectSelfCheckViolations(organizationUuid, check, result.created);
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
	const work = await getWorkOptions(settings);
	/*
	 * Н6 аудита 26.09. Было: первые 2000 находок по firstSeenAt всех организаций установки, на каждую
	 * — поиск ответственного, фирмы и запись. У клиента без ответственного отметка candidateAt не
	 * ставилась, и те же 2000 самых старых находок перебирались вечно, а новые не доходили никогда.
	 * Стало: только клиенты фирмы; обход всех находок страницами по id; ответственный и фирма — один
	 * запрос на клиента и сотрудника за тик; сигнал «нет ответственного» — один на клиента.
	 */
	const { orgUuids } = await firmScope(firm, await loadGroups(firm), now);
	const responsibleOf = new Map();
	const firmOf = new Map();
	const noResponsible = new Map(); // клиент → задача по находкам (для ссылки в сигнале)
	let created = 0;
	let after = 0;
	for (;;) {
		const rows = await prisma.checkFinding.findMany({
			where: { organizationUuid: { in: orgUuids }, resolvedAt: null, candidateAt: null, severity: "error", id: { gt: after } },
			orderBy: { id: "asc" },
			take: FINDINGS_PAGE,
		});
		if (!rows.length) break;
		after = rows[rows.length - 1].id;
		const have = await existingRuleKeys(rows.map((f) => `finding:${f.uuid}`));
		const marked = [];
		for (const f of rows) {
			if (exceptionActive(f, now)) continue;
			const days = findingDeadlineDays(f.checkCode, settings);
			const due = work ? addWorkingDays(f.firstSeenAt, days, work) : new Date(new Date(f.firstSeenAt).getTime() + days * 86_400_000);
			if (now.getTime() < due.getTime()) continue;
			const item = standardItemFor(f.checkCode, f);
			if (!item) continue;
			if (!responsibleOf.has(f.organizationUuid)) responsibleOf.set(f.organizationUuid, await responsibleForClient(f.organizationUuid));
			const responsible = responsibleOf.get(f.organizationUuid);
			// Ответственного нет — кандидата некому адресовать (нарушение без нарушителя не бывает). Главбух
			// группы (или администратор) получает сигнал назначить ответственного; правило вернётся к
			// находке на следующем круге, когда он появится.
			if (!responsible) {
				if (!noResponsible.has(f.organizationUuid)) noResponsible.set(f.organizationUuid, f.todoUuid);
				continue;
			}
			if (!have.has(`finding:${f.uuid}`)) {
				if (!firmOf.has(responsible)) firmOf.set(responsible, await firmOrgForUser(responsible));
				const c = await createCandidate({
					userUuid: responsible, itemNumber: item, rule: "finding_overdue", ruleKey: `finding:${f.uuid}`,
					firmOrgUuid: firmOf.get(responsible),
					clientOrganizationUuid: f.organizationUuid,
					occurredAt: new Date(new Date(f.firstSeenAt).getTime() + days * 86_400_000),
					description: `Не отработана за ${days} дн. находка проверки учёта «${checkTitle(f.checkCode)}»: ${f.title}`,
					evidence: [{ kind: "finding", uuid: f.uuid, label: f.title, checkCode: f.checkCode, todoUuid: f.todoUuid }],
				});
				if (c) created++;
			}
			marked.push(f.uuid);
		}
		if (marked.length) await prisma.checkFinding.updateMany({ where: { uuid: { in: marked } }, data: { candidateAt: now } });
		if (rows.length < FINDINGS_PAGE) break;
	}
	for (const [org, todoUuid] of noResponsible) await notifyNoResponsible(org, todoUuid);
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
	const day = new Date().toISOString().slice(0, 10);
	// Раз в сутки на клиента: уже уведомлённым повторно не пишем (dedupBatch.js), а не ловим P2002.
	const dedupKey = `no-responsible:${organizationUuid}:${day}`;
	to = freshRecipients(to, dedupKey, await sentNotificationKeys(manyKeys(to, dedupKey)));
	if (!to.length) return;
	const name = (await orgNames([organizationUuid])).get(organizationUuid) ?? "клиент";
	await notifyMany(to, {
		kind: "no_responsible",
		title: `Нет ответственного бухгалтера: ${name}`,
		body: group
			? "Проверки учёта нашли ошибки, но задачу некому поставить. Назначьте ответственного в «Группах сотрудников»."
			: "Клиент не входит ни в одну группу сотрудников: добавьте его в группу и назначьте ответственного.",
		link: todoUuid ? { endpoint: "todos", uuid: todoUuid } : { pane: "StaffGroupsList" },
		organizationUuid,
		dedupKey,
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

export default { ingestCheckResults, lockCheckIngest, CheckIngestBusyError, INGEST_LOCK_WAIT_MS, syncSummaryTask, runFindingCandidates, setFindingException, clearFindingException, compareKn };
