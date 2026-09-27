// Охват фирмы для фоновых правил E17 (Н6 аудита 26.09).
//
// SLA-джоб брал просроченные задачи ВСЕХ организаций установки: исполнитель из чужого арендатора
// получал кандидата в реестре фирмы, а названия чужих задач видели её администраторы. Правила
// стандарта — внутреннее дело фирмы и её клиентов, поэтому охват такой:
//   • сама организация-фирма;
//   • клиенты её групп сотрудников (StaffGroupClient);
//   • клиенты по живым связям обслуживания (ServiceLink: подтверждена и срок не вышел);
//   • задачи БЕЗ организации — только если исполнитель сотрудник фирмы (участник, главбух или
//     руководитель её групп): иначе такая задача ничья, и судить по ней некого.
import { prisma } from "../../prisma/prisma-client.js";
import { linkIsLive } from "../serviceLinks.js";

/** Чистая часть: охват по группам фирмы и её живым связям. */
export function buildFirmScope(firmOrgUuid, groups, links = [], now = new Date()) {
	const orgs = new Set(firmOrgUuid ? [firmOrgUuid] : []);
	const staff = new Set();
	for (const g of groups || []) {
		for (const c of g.clients || []) if (c.clientOrganizationUuid) orgs.add(c.clientOrganizationUuid);
		if (g.headUuid) staff.add(g.headUuid);
		if (g.managerUuid) staff.add(g.managerUuid);
		for (const m of g.members || []) if (m.userUuid) staff.add(m.userUuid);
	}
	for (const l of links || []) if (linkIsLive(l, now) && l.clientOrgUuid) orgs.add(l.clientOrgUuid);
	return { orgUuids: [...orgs], staffUuids: [...staff] };
}

/** Охват фирмы: группы — уже загруженные (loadGroups(firm)), связи — одним запросом. */
export async function firmScope(firmOrgUuid, groups, now = new Date()) {
	const links = firmOrgUuid
		? await prisma.serviceLink.findMany({ where: { serviceOrgUuid: firmOrgUuid, state: "active" }, select: { clientOrgUuid: true, state: true, validUntil: true } })
		: [];
	return buildFirmScope(firmOrgUuid, groups, links, now);
}

/** Условие Prisma «задача в охвате фирмы». */
export function todoScopeWhere(scope) {
	const or = [{ organizationUuid: { in: scope.orgUuids } }];
	if (scope.staffUuids.length) or.push({ organizationUuid: null, executorUuid: { in: scope.staffUuids } });
	return { OR: or };
}

export default { buildFirmScope, firmScope, todoScopeWhere };
