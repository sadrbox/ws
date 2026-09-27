// ─────────────────────────────────────────────────────────────────────────────
// Движок амортизации основных средств.
//
// Источник данных — проведённые документы «Принятие к учёту ОС»
// (fixed_asset_acceptance). Начисление выполняется при закрытии месяца: правило
// POSTING_RULES.month_close вызывает computeDepreciationEntries() за период и
// проводит Дт depreciationAccount (7210) Кт accumulatedAccount (2420) с субконто
// «Основное средство».
//
// Метод (старт): линейный — (первоначальная − ликвидационная) / срок (мес.).
// Амортизация начинается с месяца, СЛЕДУЮЩЕГО за месяцем ввода в эксплуатацию
// (практика РК). Накопленная амортизация не превышает амортизируемую базу.
// ─────────────────────────────────────────────────────────────────────────────

import { r2 } from "./money.js";
import { localMonthIndex, startOfLocalDay, endOfLocalDay, orgTimeZone } from "./periodBounds.js";

// Месяцы — МЕСТНЫЕ, в поясе организации (У5 аудита 26.09). Раньше месяц брался по UTC:
// ОС, введённое 01.06 в 00:00 по Алматы (31.05 19:00 UTC), считалось введённым в мае и
// амортизировалось с июня, а не с июля.

/**
 * Накопленная амортизация ОС на счёте accumulatedAccount ДО beforeDate
 * (по субконто «Основное средство»). Берётся из зарегистрированных проводок.
 */
async function accumulatedBefore(client, orgUuid, accumulatedAccount, assetUuid, beforeDate) {
	const rows = await client.accountingEntryAnalytic.findMany({
		where: {
			subkontoType: "FixedAsset",
			objectUuid: assetUuid,
			side: "credit",
			entry: {
				creditAccountCode: accumulatedAccount,
				organizationUuid: orgUuid,
				date: { lt: beforeDate },
			},
		},
		select: { entry: { select: { amount: true } } },
	});
	return rows.reduce((s, a) => s + Number(a.entry?.amount || 0), 0);
}

/**
 * Начисления амортизации за период [periodStart, periodEnd] по всем ОС организации,
 * принятым к учёту (проведённый акт с заданными сроком и датой старта).
 *
 * @returns {Promise<Array<{ fixedAssetUuid: string, amount: number, debitAccount: string, creditAccount: string }>>}
 */
export async function computeDepreciationEntries(client, orgUuid, periodStart, periodEnd) {
	if (!orgUuid) return [];
	const tz = orgTimeZone(orgUuid);
	const start = startOfLocalDay(periodStart, tz);
	const end = endOfLocalDay(periodEnd, tz);
	if (!start || !end) return [];

	const acceptances = await client.fixedAssetAcceptance.findMany({
		where: {
			organizationUuid: orgUuid,
			posted: true,
			deletedAt: null,
			depreciationStartDate: { not: null, lte: end },
			usefulLifeMonths: { gt: 0 },
		},
	});

	const periodStartM = localMonthIndex(start, tz);
	const periodEndM = localMonthIndex(end, tz);
	const out = [];

	for (const a of acceptances) {
		const life = Number(a.usefulLifeMonths) || 0;
		if (life <= 0) continue;
		const base = r2(Number(a.initialCost) - Number(a.liquidationValue));
		if (base <= 0) continue;
		const monthly = base / life;

		// Первый амортизируемый месяц — следующий за месяцем ввода в эксплуатацию.
		const firstDepM = localMonthIndex(new Date(a.depreciationStartDate), tz) + 1;
		const fromM = Math.max(periodStartM, firstDepM);
		const monthsInPeriod = Math.max(0, periodEndM - fromM + 1);
		if (monthsInPeriod === 0) continue;

		const accAccount = a.accumulatedAccount || "2420";
		const already = await accumulatedBefore(client, orgUuid, accAccount, a.fixedAssetUuid, start);
		const remaining = r2(base - already);
		if (remaining <= 0) continue;

		const amount = r2(Math.min(monthly * monthsInPeriod, remaining));
		if (amount <= 0.005) continue;

		out.push({
			fixedAssetUuid: a.fixedAssetUuid,
			amount,
			debitAccount: a.depreciationAccount || "7210",
			creditAccount: accAccount,
		});
	}

	return out;
}
