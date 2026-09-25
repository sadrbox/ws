// Чек-листы самопроверки (E17 СК3, пп. 26–28).
//
//  * пункт с привязкой к проверке учёта нельзя отметить «ок», пока по ней открыты находки с
//    важностью error; при открытых предупреждениях «ок» — только с комментарием (что решили);
//  * после отметки «ок» прогон нашёл за тот же период находку этой проверки — кандидат по
//    п. 27 (недостоверная самопроверка) исполнителю, а если главбух подписал чек-лист — ещё и
//    по п. 28 (недостаточный контроль главбуха).
// ПРОВЕРИТЬ ПОТОМ: находка, внесённая в 1С ПОСЛЕ отметки задним числом, выглядит так же, как
// пропущенная при самопроверке. Система отличить их не может — кандидата решает главбух.
import { prisma } from "../../prisma/prisma-client.js";
import { exceptionActive, checkTitle } from "./findingRules.js";
import { createCandidate } from "./violations.js";

export const ITEM_STATUSES = ["pending", "ok", "na", "problem"];

/** Создать прогон чек-листа по шаблону для клиента за период. */
export async function createRunFromTemplate({ template, clientOrganizationUuid, periodFrom, periodTo, executorUuid, reviewerUuid, firmOrgUuid }) {
	const items = [...(template.items || [])].sort((a, b) => a.position - b.position);
	return prisma.checklistRun.create({
		data: {
			organizationUuid: firmOrgUuid,
			clientOrganizationUuid,
			templateUuid: template.uuid,
			name: template.name,
			periodFrom,
			periodTo,
			executorUuid: executorUuid || null,
			reviewerUuid: reviewerUuid || null,
			items: { create: items.map((i, idx) => ({ position: i.position ?? idx, text: i.text, checkCode: i.checkCode || null })) },
		},
		include: { items: { orderBy: { position: "asc" } } },
	});
}

/** Открытые находки проверки у клиента (без исключений), разложенные по важности. */
async function openFindingsOf(clientOrganizationUuid, checkCode) {
	const rows = await prisma.checkFinding.findMany({ where: { organizationUuid: clientOrganizationUuid, checkCode, resolvedAt: null } });
	const live = rows.filter((f) => !exceptionActive(f));
	return { errors: live.filter((f) => f.severity === "error"), warnings: live.filter((f) => f.severity === "warning") };
}

/**
 * Отметить пункт. Возвращает { item } или { error } (текст для формы).
 * @param {{run:object, item:object, status:string, comment?:string, userUuid:string}} p
 */
export async function markItem({ run, item, status, comment, userUuid }) {
	if (!ITEM_STATUSES.includes(status)) return { error: "Неизвестная отметка пункта" };
	if (run.status === "reviewed") return { error: "Чек-лист подписан главбухом — отметки не меняются" };
	const text = String(comment ?? "").trim();
	if (status === "problem" && !text) return { error: "Для отметки «проблема» опишите, что не так" };
	if (status === "ok" && item.checkCode) {
		const { errors, warnings } = await openFindingsOf(run.clientOrganizationUuid, item.checkCode);
		if (errors.length) {
			return { error: `Нельзя отметить «ок»: по проверке «${checkTitle(item.checkCode)}» открыто ошибок — ${errors.length}. Отработайте находки или поставьте «проблема» с комментарием` };
		}
		if (warnings.length && !text) {
			return { error: `По проверке «${checkTitle(item.checkCode)}» открыто предупреждений — ${warnings.length}. Отметить «ок» можно с комментарием: что решили по ним` };
		}
	}
	const updated = await prisma.checklistRunItem.update({
		where: { uuid: item.uuid },
		data: {
			status,
			comment: text || null,
			confirmedByUuid: status === "pending" ? null : userUuid,
			confirmedAt: status === "pending" ? null : new Date(),
		},
	});
	return { item: updated };
}

/** Сдать чек-лист главбуху: все пункты отмечены. */
export async function submitRun(run) {
	const items = await prisma.checklistRunItem.findMany({ where: { runUuid: run.uuid } });
	const pending = items.filter((i) => i.status === "pending").length;
	if (pending) return { error: `Не отмечено пунктов: ${pending}` };
	if (run.status !== "open") return { error: "Чек-лист уже сдан" };
	return { run: await prisma.checklistRun.update({ where: { uuid: run.uuid }, data: { status: "submitted", submittedAt: new Date() } }) };
}

/** Подписать чек-лист (главбух). Подпись — установленный контроль главбуха для п. 28. */
export async function reviewRun(run, reviewerUuid) {
	if (run.status !== "submitted") return { error: "Подписать можно только сданный чек-лист" };
	return { run: await prisma.checklistRun.update({ where: { uuid: run.uuid }, data: { status: "reviewed", reviewedAt: new Date(), reviewerUuid } }) };
}

/**
 * Новые находки проверки у клиента против отмеченных «ок» пунктов с той же проверкой, чей
 * период покрывает дату находки. Один кандидат на пункт (ruleKey по пункту), а не на находку:
 * двадцать находок одной пропущенной проверки — это одна недостоверная отметка.
 */
export async function detectSelfCheckViolations(clientOrganizationUuid, checkCode, newFindings) {
	// Только ошибки — как и запрет «ок» (СК3.2) и кандидаты по просрочке находки: предупреждение
	// значит «нужен анализ и решение», и отметка «ок» после анализа честна. Иначе новое правило 1С
	// опровергало бы отметки, сделанные до него: первый прогон `counterparties.contacts` версии 2
	// даёт `contacts_never_verified` по каждому контрагенту (отметок «контакты проверены» в 1С ещё
	// нет ни у кого) — и каждый отмеченный пункт о контактах стал бы кандидатом по п. 27.
	// ПРОВЕРИТЬ ПОТОМ: владелец может решить, что недостоверна и отметка при предупреждении.
	const relevant = newFindings.filter((f) => f.severity === "error");
	if (!relevant.length) return 0;
	const items = await prisma.checklistRunItem.findMany({
		where: { checkCode, status: "ok", confirmedAt: { not: null }, run: { clientOrganizationUuid, deletedAt: null } },
		include: { run: true },
	});
	let created = 0;
	for (const item of items) {
		const hits = relevant.filter((f) => {
			// Без даты факта — считаем, что находка относится к текущему состоянию, т. е. к любому
			// открытому периоду; с датой — период чек-листа должен её покрывать.
			if (!f.factDate) return true;
			const t = new Date(f.factDate).getTime();
			return t >= new Date(item.run.periodFrom).getTime() && t <= new Date(item.run.periodTo).getTime() + 86_399_999;
		});
		if (!hits.length) continue;
		const evidence = [
			{ kind: "checklist", uuid: item.run.uuid, label: item.run.name, itemUuid: item.uuid, itemText: item.text },
			...hits.slice(0, 10).map((f) => ({ kind: "finding", uuid: f.uuid, label: f.title })),
		];
		if (item.confirmedByUuid) {
			const c = await createCandidate({
				userUuid: item.confirmedByUuid, itemNumber: 27, rule: "self_check", ruleKey: `selfcheck:${item.uuid}`,
				clientOrganizationUuid,
				description: `Пункт чек-листа «${item.text}» отмечен «ок», а проверка «${checkTitle(checkCode)}» нашла за тот же период: ${hits.length}`,
				evidence,
			});
			if (c) created++;
		}
		if (item.run.status === "reviewed" && item.run.reviewerUuid) {
			const c = await createCandidate({
				userUuid: item.run.reviewerUuid, itemNumber: 28, rule: "chief_control", ruleKey: `chiefcontrol:${item.uuid}`,
				clientOrganizationUuid,
				description: `Чек-лист «${item.run.name}» подписан, но по пункту «${item.text}» проверка «${checkTitle(checkCode)}» нашла: ${hits.length}`,
				evidence,
			});
			if (c) created++;
		}
	}
	return created;
}

export default { ITEM_STATUSES, createRunFromTemplate, markItem, submitRun, reviewRun, detectSelfCheckViolations };
