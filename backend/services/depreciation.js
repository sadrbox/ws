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

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Индекс месяца (год*12 + месяц, 0-базовый) по UTC — для счёта месяцев. */
const monthIndex = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth();

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
	const start = new Date(periodStart);
	const end = new Date(periodEnd);
	if (isNaN(start) || isNaN(end)) return [];

	const acceptances = await client.fixedAssetAcceptance.findMany({
		where: {
			organizationUuid: orgUuid,
			posted: true,
			deletedAt: null,
			depreciationStartDate: { not: null, lte: end },
			usefulLifeMonths: { gt: 0 },
		},
	});

	const periodStartM = monthIndex(start);
	const periodEndM = monthIndex(end);
	const out = [];

	for (const a of acceptances) {
		const life = Number(a.usefulLifeMonths) || 0;
		if (life <= 0) continue;
		const base = r2(Number(a.initialCost) - Number(a.liquidationValue));
		if (base <= 0) continue;
		const monthly = base / life;

		// Первый амортизируемый месяц — следующий за месяцем ввода в эксплуатацию.
		const firstDepM = monthIndex(new Date(a.depreciationStartDate)) + 1;
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
