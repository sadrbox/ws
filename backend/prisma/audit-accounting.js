// ─────────────────────────────────────────────────────────────────────────────
// Аудит корректности учёта на сгенерированном наборе.
//
// Проверяет инварианты, которые обязаны выполняться независимо от профиля учёта
// организации. Каждый пункт — это то, что при поломке проявится в отчётах:
// ОСВ не сойдётся, прибыль поедет, остатки разойдутся с регистром.
//
// Запуск:  node prisma/audit-accounting.js
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./prisma-client.js";

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const findings = [];
const ok = [];

function check(pass, title, detail) {
	(pass ? ok : findings).push({ title, detail });
	console.log(`${pass ? "  ✅" : "  ❌"} ${title}${detail ? `\n       ${detail}` : ""}`);
}

async function main() {
	const orgs = await prisma.organization.findMany({
		where: { bin: { startsWith: "9990" }, deletedAt: null },
		select: { uuid: true, name: true },
		orderBy: { id: "asc" },
	});
	const settings = new Map();
	for (const o of orgs) {
		settings.set(
			o.uuid,
			await prisma.organizationAccountingSetting.findFirst({
				where: { organizationUuid: o.uuid },
				orderBy: { startDate: "desc" },
			}),
		);
	}

	// ── 1. Целостность проводок ──────────────────────────────────────────────
	// Равенство Дт=Кт здесь структурное: проводка — одна строка «Дт счёт / Кт счёт /
	// сумма», перекоса быть не может. Проверяем то, что реально ломается: ссылку на
	// несуществующий счёт (в ОСВ такая сумма просто пропадёт) и нулевую сумму.
	console.log("\n▸ 1. Целостность проводок");
	const orphanAcc = await prisma.$queryRaw`
		SELECT count(*)::int AS n FROM accounting_entries e
		WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.code = e."debitAccountCode")
		   OR NOT EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.code = e."creditAccountCode")
	`;
	check(
		orphanAcc[0].n === 0,
		`Проводок со счётом вне плана счетов: ${orphanAcc[0].n}`,
		orphanAcc[0].n > 0 ? "В ОСВ такие суммы не попадут — баланс не сойдётся." : "",
	);
	const zeroAmt = await prisma.$queryRaw`
		SELECT count(*)::int AS n FROM accounting_entries WHERE ROUND("amount", 2) = 0
	`;
	check(zeroAmt[0].n === 0, `Проводок с нулевой суммой: ${zeroAmt[0].n}`);

	// ── 2. Суммы строк: amount = amountWithoutVat + vatAmount ────────────────
	console.log("\n▸ 2. Арифметика строк документов");
	for (const table of ["sale_items", "purchase_items"]) {
		const bad = await prisma.$queryRawUnsafe(`
			SELECT count(*)::int AS n FROM ${table}
			WHERE ROUND("amount", 2) <> ROUND(COALESCE("amountWithoutVat",0) + COALESCE("vatAmount",0), 2)
		`);
		check(bad[0].n === 0, `${table}: amount = Сумма без НДС + НДС — расхождений ${bad[0].n}`);
	}

	// ── 3. База НДС включает акциз (НК РК ст.381) ────────────────────────────
	console.log("\n▸ 3. Акциз входит в облагаемый оборот по НДС");
	const exciseBad = await prisma.$queryRaw`
		SELECT count(*)::int AS n FROM sale_items
		WHERE COALESCE("exciseAmount",0) > 0
		  AND ROUND("amountWithoutVat", 2) < ROUND("exciseAmount", 2)
	`;
	check(exciseBad[0].n === 0, `Строк, где база НДС меньше акциза: ${exciseBad[0].n}`);

	// ── 4. Скидка не превышает стоимость ─────────────────────────────────────
	console.log("\n▸ 4. Скидки");
	const discBad = await prisma.$queryRaw`
		SELECT count(*)::int AS n FROM sale_items
		WHERE ROUND(COALESCE("discountAmount",0), 2) > ROUND("quantity" * "price", 2)
	`;
	check(discBad[0].n === 0, `Строк, где скидка больше стоимости: ${discBad[0].n}`);

	// ── 5. Флаги организации соблюдаются в данных ────────────────────────────
	console.log("\n▸ 5. Соответствие строк параметрам учёта организации");
	for (const o of orgs) {
		const s = settings.get(o.uuid);
		if (!s) continue;
		const rows = await prisma.$queryRaw`
			SELECT
				count(*) FILTER (WHERE COALESCE(si."exciseAmount",0)   > 0)::int AS excise,
				count(*) FILTER (WHERE COALESCE(si."discountAmount",0) > 0)::int AS discount,
				count(*) FILTER (WHERE COALESCE(si."vatAmount",0)      > 0)::int AS vat
			FROM sale_items si JOIN sales s2 ON s2.uuid = si."saleUuid"
			WHERE s2."organizationUuid" = ${o.uuid}
		`;
		const { excise, discount, vat } = rows[0];
		const name = o.name.replace(/^ТОО | \(ТЕСТ\)$/g, "");
		if (!s.useExcise) check(excise === 0, `${name}: акциз выключен — строк с акцизом ${excise}`);
		if (!s.useDiscount) check(discount === 0, `${name}: скидки выключены — строк со скидкой ${discount}`);
		if (!s.useVat) check(vat === 0, `${name}: НДС выключен — строк с НДС ${vat}`);
		if (s.useExcise) check(excise > 0, `${name}: акциз включён — строк с акцизом ${excise} (ожидались > 0)`);
		if (s.useDiscount) check(discount > 0, `${name}: скидки включены — строк со скидкой ${discount} (ожидались > 0)`);
	}

	// ── 6. Регистр ТМЗ: нет отрицательных остатков ───────────────────────────
	console.log("\n▸ 6. Остатки ТМЗ");
	const neg = await prisma.$queryRaw`
		SELECT count(*)::int AS n FROM (
			SELECT "productUuid", "warehouseUuid",
			       SUM(CASE WHEN "movementType" = 'in' THEN "quantity" ELSE -"quantity" END) AS q
			FROM product_register GROUP BY 1, 2
		) t WHERE t.q < 0
	`;
	check(neg[0].n === 0, `Отрицательных остатков (товар+склад): ${neg[0].n}`);

	// ── 7. Себестоимость выбытия не нулевая ──────────────────────────────────
	// Ноль в out.amount при ненулевом остатке = COGS 0 → прибыль завышена.
	console.log("\n▸ 7. Себестоимость выбытия (COGS)");
	const zeroCogs = await prisma.$queryRaw`
		SELECT count(*)::int AS n FROM product_register
		WHERE "movementType" = 'out' AND COALESCE("amount", 0) = 0 AND "quantity" > 0
	`;
	check(
		zeroCogs[0].n === 0,
		`Движений выбытия с нулевой себестоимостью: ${zeroCogs[0].n}`,
		zeroCogs[0].n > 0 ? "Прибыль в отчёте о продажах будет завышена на эту сумму." : "",
	);

	// ── 8. Проводки есть у всех проведённых документов ───────────────────────
	console.log("\n▸ 8. Проведённые документы имеют проводки");
	const noEntries = await prisma.$queryRaw`
		SELECT count(*)::int AS n FROM sales s
		WHERE s.posted = true
		  AND NOT EXISTS (SELECT 1 FROM accounting_entries e WHERE e."documentUuid" = s.uuid)
	`;
	check(noEntries[0].n === 0, `Проведённых реализаций без проводок: ${noEntries[0].n}`);

	// ── 9. Выручка в проводках сходится с суммами документов ─────────────────
	console.log("\n▸ 9. Выручка (счёт 6010) сходится с реализациями");
	const revenue = await prisma.$queryRaw`
		SELECT
			(SELECT COALESCE(SUM("amount"),0) FROM accounting_entries
			  WHERE "creditAccountCode" LIKE '6010%' AND "documentType" = 'sale')::numeric AS entries,
			(SELECT COALESCE(SUM(si."amountWithoutVat"),0) FROM sale_items si
			   JOIN sales s ON s.uuid = si."saleUuid" WHERE s.posted = true)::numeric AS docs
	`;
	const diff = r2(Number(revenue[0].entries) - Number(revenue[0].docs));
	check(
		Math.abs(diff) < 1,
		`Выручка: проводки ${r2(revenue[0].entries)} vs документы ${r2(revenue[0].docs)}, расхождение ${diff}`,
		Math.abs(diff) >= 1 ? "Отчёт о продажах и ОСВ покажут разные суммы." : "",
	);

	// ── 10. Инвариант регистра: out.amount реализации = COGS, а не выручка ───
	// Именно на неоднозначности этого поля сломалась «Ведомость по материалам»:
	// движок себестоимости принимал amount за выручку и показывал прибыль 0.
	// Проводка реализации ПРОЕЦИРУЕТ значение регистра (Дт 7010 Кт 1330), поэтому
	// суммы обязаны совпадать — расхождение означает, что смысл поля снова уехал.
	console.log("\n▸ 10. Инвариант регистра (out.amount реализации = себестоимость)");
	const inv = await prisma.$queryRaw`
		SELECT
			(SELECT COALESCE(SUM("amount"),0) FROM product_register
			  WHERE "documentType" = 'sale' AND "movementType" = 'out')::numeric AS register,
			(SELECT COALESCE(SUM("amount"),0) FROM accounting_entries
			  WHERE "documentType" = 'sale' AND "debitAccountCode" LIKE '7010%')::numeric AS cogs,
			(SELECT COALESCE(SUM(si."amountWithoutVat" - COALESCE(si."exciseAmount",0)),0)
			   FROM sale_items si JOIN sales s ON s.uuid = si."saleUuid"
			  WHERE s.posted = true)::numeric AS revenue
	`;
	const regSum = r2(inv[0].register), cogsSum = r2(inv[0].cogs), revSum = r2(inv[0].revenue);
	check(
		Math.abs(regSum - cogsSum) < 1,
		`Регистр ${regSum} = COGS в проводках ${cogsSum}`,
		Math.abs(regSum - cogsSum) >= 1 ? "Проводка и регистр разошлись — ОСВ не сойдётся с отчётами." : "",
	);
	check(
		Math.abs(regSum - revSum) > 1,
		`Регистр (${regSum}) отличается от выручки (${revSum}) — значит в нём себестоимость`,
		Math.abs(regSum - revSum) <= 1 ? "Похоже, в регистр снова кладут выручку вместо себестоимости." : "",
	);

	// ── 11. Деньги не уходят в минус НИ В ОДИН момент периода ────────────────
	// Отрицательная касса невозможна физически. Проверяем не конечное сальдо, а
	// минимум по хронологии: конечный плюс легко скрывает провал в середине.
	console.log("\n▸ 11. Касса и банк не уходят в минус");
	let worstCash = { min: Infinity, org: null, acc: null };
	for (const o of orgs) {
		for (const acc of ["1010", "1030"]) {
			const es = await prisma.accountingEntry.findMany({
				where: { organizationUuid: o.uuid, OR: [{ debitAccountCode: acc }, { creditAccountCode: acc }] },
				select: { amount: true, debitAccountCode: true, date: true, documentId: true, id: true },
				orderBy: [{ date: "asc" }, { documentId: "asc" }, { id: "asc" }],
			});
			if (!es.length) continue;
			let b = 0, min = Infinity;
			for (const e of es) {
				b += (e.debitAccountCode === acc ? 1 : -1) * Number(e.amount);
				if (b < min) min = b;
			}
			if (min < worstCash.min) worstCash = { min, org: o.name, acc };
		}
	}
	if (worstCash.org) {
		check(
			worstCash.min >= 0,
			`Минимальный остаток денег за период: ${r2(worstCash.min)} (${worstCash.org.replace(/^ТОО | \(ТЕСТ\)$/g, "")}, счёт ${worstCash.acc})`,
			worstCash.min < 0 ? "Предприятие платит деньгами, которых у него нет — нужны входящие остатки (капитал)." : "",
		);
	}

	// ── 12. Актив не имеет кредитового сальдо ────────────────────────────────
	console.log("\n▸ 12. Активные счета с кредитовым сальдо");
	const activeCredit = await prisma.$queryRaw`
		WITH s AS (
			SELECT code, SUM(dt) - SUM(kt) AS saldo FROM (
				SELECT "debitAccountCode" AS code, "amount" AS dt, 0 AS kt FROM accounting_entries
				UNION ALL SELECT "creditAccountCode", 0, "amount" FROM accounting_entries
			) t GROUP BY code
		)
		SELECT s.code, a.name, ROUND(s.saldo, 2) AS saldo
		FROM s JOIN chart_of_accounts a ON a.code = s.code
		WHERE a."accountType" = 'active' AND s.saldo < -0.01
	`;
	check(
		activeCredit.length === 0,
		`Активных счетов с кредитовым сальдо: ${activeCredit.length}`,
		activeCredit.map((a) => `${a.code} ${a.name}: ${a.saldo}`).join("\n       "),
	);

	// ── Итог ─────────────────────────────────────────────────────────────────
	console.log(`\n${"═".repeat(62)}`);
	console.log(`Проверок пройдено: ${ok.length}, замечаний: ${findings.length}`);
	if (findings.length) {
		console.log("\nЗАМЕЧАНИЯ:");
		for (const f of findings) console.log(`  • ${f.title}${f.detail ? `\n    ${f.detail}` : ""}`);
	}
}

main()
	.catch((e) => {
		console.error("Ошибка аудита:", e.message);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
