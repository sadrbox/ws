// Пакетная проверка «уже сделано» для фоновых правил E17 (Н6 аудита 26.09).
//
// ЗАЧЕМ. Правила идемпотентны: кандидат — по уникальному ruleKey, уведомление — по уникальному
// dedupKey. Но «идемпотентность» держалась на упавшем INSERT: SLA-джоб каждые 5 минут заново
// пытался записать уже отправленные уведомления, Postgres отвечал нарушением уникальности, код
// ловил P2002. На тысяче просрочек — тысячи ERROR в журнале PostgreSQL за тик, сгоревшие значения
// последовательности и мёртвые кортежи, плюс по 5 запросов на задачу.
//
// ТЕПЕРЬ правило сначала одним запросом на страницу задач спрашивает, какие ключи уже есть, и
// пишет только новое. Уникальный индекс остаётся страховкой от гонки двух процессов — упавший
// INSERT теперь исключение, а не способ работы.
import { prisma } from "../../prisma/prisma-client.js";

/** Какие из dedupKey уведомлений уже записаны. */
export async function sentNotificationKeys(keys, db = prisma) {
	const list = [...new Set(keys.filter(Boolean))];
	if (!list.length) return new Set();
	const rows = await db.userNotification.findMany({ where: { dedupKey: { in: list } }, select: { dedupKey: true } });
	return new Set(rows.map((r) => r.dedupKey));
}

/** Какие из ruleKey кандидатов уже заведены (в том числе отклонённые — они не возвращаются). */
export async function existingRuleKeys(keys, db = prisma) {
	const list = [...new Set(keys.filter(Boolean))];
	if (!list.length) return new Set();
	const rows = await db.standardViolation.findMany({ where: { ruleKey: { in: list } }, select: { ruleKey: true } });
	return new Set(rows.map((r) => r.ruleKey));
}

/**
 * Ключи, под которыми notifyMany(uids, { dedupKey: base }) запишет уведомления: `${base}:${uid}`.
 * Ключ notifyUser — `base` как есть.
 */
export const manyKeys = (uids, base) => [...new Set((uids || []).filter(Boolean))].map((u) => `${base}:${u}`);

/** Адресаты notifyMany, которым уведомление с этим ключом ещё не уходило. */
export const freshRecipients = (uids, base, sent) => [...new Set((uids || []).filter(Boolean))].filter((u) => !sent.has(`${base}:${u}`));

export default { sentNotificationKeys, existingRuleKeys, manyKeys, freshRecipients };
