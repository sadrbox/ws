// ─────────────────────────────────────────────────────────────────────────────
// Импорт банковской выписки (T8.1): текст файла → строки BankStatement.
//
// Направление (приход/расход) — по совпадению IBAN счёта ОРГАНИЗАЦИИ с плательщиком
// (расход) или получателем (приход); контрагент — противоположная сторона, резолв
// по БИН через общий find-or-create ([[resolver]]). Дубли (повторный импорт того же
// файла) пропускаются по ключу {number,date,amount,direction} в рамках орг+счёт.
// ─────────────────────────────────────────────────────────────────────────────
import { parseBankStatement, normalizeAccount } from "./parseStatement.js";
import { resolveCounterpartyByBin } from "../esf/resolver.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Автопривязка движения (Z10): договор контрагента + счёт на оплату по ТОЧНОЙ сумме.
 * Договор — основной/последний контрагента. Счёт — только при ОДНОЗНАЧНОМ совпадении
 * (ровно один payment_invoice той же орг+контрагента с этой суммой), иначе не привязываем.
 * @returns {Promise<{contractUuid:string|null, basis:{basisDocumentType,basisDocumentUuid,basisDocumentLabel}|null}>}
 */
export async function matchDocuments(client, { counterpartyUuid, organizationUuid, amount }) {
	if (!counterpartyUuid) return { contractUuid: null, basis: null };
	const orgWhere = organizationUuid ? { organizationUuid } : {};
	const contract = await client.contract.findFirst({
		where: { deletedAt: null, counterpartyUuid, ...orgWhere },
		orderBy: [{ isPrimary: "desc" }, { id: "desc" }],
		select: { uuid: true },
	});
	let basis = null;
	const invoices = await client.paymentInvoice.findMany({
		where: { deletedAt: null, counterpartyUuid, amount, ...orgWhere },
		select: { uuid: true, number: true },
		take: 2,
	});
	if (invoices.length === 1) {
		basis = {
			basisDocumentType: "payment_invoice",
			basisDocumentUuid: invoices[0].uuid,
			basisDocumentLabel: invoices[0].number ? `№ ${invoices[0].number}` : "б/н",
		};
	}
	return { contractUuid: contract?.uuid ?? null, basis };
}

/**
 * @param {object} client — prisma/транзакция
 * @param {object} p
 * @param {string} p.text            содержимое файла выписки
 * @param {string} p.organizationUuid
 * @param {string} p.bankAccountUuid счёт организации, по которому выписка
 * @param {string} p.authorUuid      обязателен (BankStatement.authorUuid NOT NULL)
 * @returns {Promise<{format,total,imported,skipped,unresolved,errors:string[]}>}
 */
export async function importBankStatements(client, { text, organizationUuid, bankAccountUuid, authorUuid, match = true }) {
	if (!authorUuid) throw new Error("authorUuid обязателен (автор выписки)");
	if (!bankAccountUuid) throw new Error("bankAccountUuid обязателен (счёт организации)");
	const account = await client.bankAccount.findUnique({ where: { uuid: bankAccountUuid } });
	if (!account) throw new Error("Банковский счёт не найден");
	const orgIban = normalizeAccount(account.iban);

	const { format, ownerAccount, movements } = parseBankStatement(text);
	const result = { format, total: movements.length, imported: 0, skipped: 0, unresolved: 0, matched: 0, errors: [] };

	for (const mv of movements) {
		// 1) Направление.
		let direction = null;
		if (orgIban && mv.payerAccount === orgIban) direction = "out";
		else if (orgIban && mv.payeeAccount === orgIban) direction = "in";
		else if (ownerAccount && mv.payerAccount === ownerAccount) direction = "out";
		else if (ownerAccount && mv.payeeAccount === ownerAccount) direction = "in";
		else if (mv.explicitDirection) direction = mv.explicitDirection;
		if (!direction) { result.unresolved++; continue; } // не понять сторону — пропускаем

		const enumDir = direction === "out" ? "bankStatementOut" : "bankStatementIn";
		const cpName = direction === "out" ? mv.payeeName : mv.payerName;
		const cpBin = direction === "out" ? mv.payeeBin : mv.payerBin;
		const amount = round2(mv.amount);
		const date = mv.date ? new Date(mv.date) : new Date();

		// 2) Дедуп — тот же документ в рамках орг+счёт (повторный импорт файла).
		const dup = await client.bankStatement.findFirst({
			where: {
				deletedAt: null,
				organizationUuid: organizationUuid || null,
				bankAccountUuid,
				direction: enumDir,
				amount,
				date,
				...(mv.number ? { number: String(mv.number) } : {}),
			},
			select: { uuid: true },
		});
		if (dup) { result.skipped++; continue; }

		// 3) Контрагент (find-or-create по БИН). Только если есть БИН или имя —
		//    иначе (напр. скудный :86: в MT940) не плодим пустых контрагентов.
		let counterpartyUuid = null;
		if (cpBin || (cpName && cpName.trim())) {
			try {
				const cp = await resolveCounterpartyByBin(client, { bin: cpBin || null, name: cpName || null, organizationUuid });
				counterpartyUuid = cp.uuid;
			} catch (e) {
				result.errors.push(`Контрагент (${cpName || cpBin || "?"}): ${e.message}`);
			}
		}

		// 4) Автопривязка (Z10): договор контрагента + счёт на оплату по сумме.
		let contractUuid = null;
		let basis = null;
		if (match && counterpartyUuid) {
			try {
				const m = await matchDocuments(client, { counterpartyUuid, organizationUuid, amount });
				contractUuid = m.contractUuid;
				basis = m.basis;
				if (basis) result.matched++;
			} catch (e) {
				result.errors.push(`Автопривязка (${mv.number || amount}): ${e.message}`);
			}
		}

		// 5) Создать строку выписки.
		await client.bankStatement.create({
			data: {
				number: mv.number ? String(mv.number) : null,
				date,
				direction: enumDir,
				amount,
				comment: mv.purpose || null,
				organizationUuid: organizationUuid || null,
				bankAccountUuid,
				counterpartyUuid,
				contractUuid,
				...(basis || {}),
				authorUuid,
				posted: false, // импортируем НЕпроведёнными — пользователь проверяет и проводит
			},
		});
		result.imported++;
	}
	return result;
}

export default { importBankStatements };
