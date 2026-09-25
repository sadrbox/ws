// Реестр нарушений (E17 СК5) — работа с базой: справочник пунктов, кандидаты от правил.
//
// Кандидат — ещё не нарушение. Правило заводит его ИДЕМПОТЕНТНО по ruleKey: повторный прогон
// не плодит второго, а отклонённый главбухом кандидат не возвращается следующим прогоном.
import { prisma } from "../../prisma/prisma-client.js";
import { STANDARD_ITEMS, STANDARD_VERSION } from "./standardItems.js";
import { getQualitySettings } from "./settings.js";
import { monthOf } from "./time.js";
import { firmOrgForUser, decidersOf, userNames } from "./access.js";
import { notifyMany } from "./notify.js";

/** Заполнить справочник пунктов фирмы из стандарта, если он пуст. Возвращает число созданных. */
export async function ensureStandardItems(firmOrgUuid) {
	if (!firmOrgUuid) return 0;
	const count = await prisma.standardItem.count({ where: { organizationUuid: firmOrgUuid } });
	if (count > 0) return 0;
	const res = await prisma.standardItem.createMany({
		data: STANDARD_ITEMS.map((i) => ({
			organizationUuid: firmOrgUuid, number: i.number, title: i.title, text: i.text,
			appliesTo: i.appliesTo, kind: i.kind, version: STANDARD_VERSION,
		})),
		skipDuplicates: true,
	});
	return res.count;
}

/** Закрытые месяцы бонусов фирмы. */
export async function closedMonths(firmOrgUuid) {
	if (!firmOrgUuid) return new Set();
	const rows = await prisma.bonusMonth.findMany({ where: { organizationUuid: firmOrgUuid }, select: { month: true } });
	return new Set(rows.map((r) => r.month));
}

/**
 * Завести кандидата в нарушения от правила.
 * @param {{userUuid:string, itemNumber:number, description:string, ruleKey:string, rule:string,
 *          clientOrganizationUuid?:string|null, evidence?:object[], occurredAt?:Date, firmOrgUuid?:string|null}} c
 * @returns {Promise<object|null>} кандидат или null (нет нарушителя / уже заведён)
 */
export async function createCandidate(c) {
	if (!c.userUuid || !c.itemNumber || !c.ruleKey) return null;
	const exists = await prisma.standardViolation.findUnique({ where: { ruleKey: c.ruleKey }, select: { uuid: true } });
	if (exists) return null;
	const firmOrgUuid = c.firmOrgUuid ?? (await firmOrgForUser(c.userUuid));
	// Учёт качества не включён (организация-фирма не назначена) — реестра нет, кандидата не
	// заводим: запись без фирмы не увидел бы никто, а уведомлять было бы некого.
	if (!firmOrgUuid) return null;
	const settings = await getQualitySettings(firmOrgUuid);
	// Стандарт не действует задним числом: факт до даты введения — не кандидат.
	if (!settings.effectiveFrom || (c.occurredAt && new Date(c.occurredAt) < new Date(`${settings.effectiveFrom}T00:00:00Z`))) return null;
	await ensureStandardItems(firmOrgUuid);
	const item = firmOrgUuid
		? await prisma.standardItem.findFirst({ where: { organizationUuid: firmOrgUuid, number: c.itemNumber, deletedAt: null }, select: { uuid: true, isActive: true, title: true } })
		: null;
	// Пункт выключили в справочнике — правило молчит: фирма решила его не применять.
	if (item && item.isActive === false) return null;
	const now = new Date();
	let row;
	try {
		row = await prisma.standardViolation.create({
			data: {
				organizationUuid: firmOrgUuid,
				userUuid: c.userUuid,
				clientOrganizationUuid: c.clientOrganizationUuid ?? null,
				standardItemUuid: item?.uuid ?? null,
				itemNumber: c.itemNumber,
				occurredAt: c.occurredAt ?? now,
				detectedAt: now,
				bonusMonth: monthOf(now, settings.tzOffsetMinutes),
				description: String(c.description).slice(0, 2000),
				evidence: c.evidence ?? undefined,
				source: `rule:${c.rule}`,
				ruleKey: c.ruleKey,
				status: "candidate",
			},
		});
	} catch (e) {
		if (e?.code === "P2002") return null; // гонка двух процессов — второй молча уступает
		throw e;
	}
	const deciders = await decidersOf(firmOrgUuid, c.userUuid);
	const names = await userNames([c.userUuid]);
	await notifyMany(deciders, {
		kind: "violation_candidate",
		title: `Кандидат в нарушения: п. ${c.itemNumber}${item?.title ? ` «${item.title}»` : ""}`,
		body: `${names.get(c.userUuid) ?? ""}: ${row.description}`,
		link: { endpoint: "standard-violations", uuid: row.uuid },
		organizationUuid: firmOrgUuid,
		dedupKey: `violation:${row.uuid}`,
	});
	return row;
}

export default { ensureStandardItems, closedMonths, createCandidate };
