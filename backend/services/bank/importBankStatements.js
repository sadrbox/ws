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
 * @param {object} client — prisma/транзакция
 * @param {object} p
 * @param {string} p.text            содержимое файла выписки
 * @param {string} p.organizationUuid
 * @param {string} p.bankAccountUuid счёт организации, по которому выписка
 * @param {string} p.authorUuid      обязателен (BankStatement.authorUuid NOT NULL)
 * @returns {Promise<{format,total,imported,skipped,unresolved,errors:string[]}>}
 */
export async function importBankStatements(client, { text, organizationUuid, bankAccountUuid, authorUuid }) {
	if (!authorUuid) throw new Error("authorUuid обязателен (автор выписки)");
	if (!bankAccountUuid) throw new Error("bankAccountUuid обязателен (счёт организации)");
	const account = await client.bankAccount.findUnique({ where: { uuid: bankAccountUuid } });
	if (!account) throw new Error("Банковский счёт не найден");
	const orgIban = normalizeAccount(account.iban);

	const { format, ownerAccount, movements } = parseBankStatement(text);
	const result = { format, total: movements.length, imported: 0, skipped: 0, unresolved: 0, errors: [] };

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

		// 4) Создать строку выписки.
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
				authorUuid,
				posted: false, // импортируем НЕпроведёнными — пользователь проверяет и проводит
			},
		});
		result.imported++;
	}
	return result;
}

export default { importBankStatements };
