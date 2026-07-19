// ─────────────────────────────────────────────────────────────────────────────
// Контроль остатка денежных средств в кассе (счёт 1010).
//
// Зачем. Отрицательный склад система не допускает — assertStockForPosting бросает
// 409 при проведении. По деньгам такой защиты не было: расходный ордер уводил
// кассу в минус молча. На сгенерированном наборе это дало сальдо −44 млн, то есть
// предприятие платило деньгами, которых у него не было, а ОСВ показывала
// кредитовое сальдо у активного счёта.
//
// Почему по СЧЁТУ, а не по кассе. Кассу двигают два типа документов: расходные
// ордера (у них есть cashboxUuid) и выплаты зарплаты (у них его НЕТ — поле есть
// только у CashOrder). Субконто «Касса» у счёта 1010 в плане счетов тоже нет,
// поэтому разложить остаток по конкретным кассам нечем. Единственная величина,
// которая учитывает все движения и совпадает с тем, что видит пользователь в
// ОСВ, — остаток счёта 1010 по организации.
//
// Почему МИНИМУМ по хронологии, а не конечное сальдо. Расход, проведённый задним
// числом, сдвигает вниз все последующие остатки. Проверка «хватает ли денег
// сейчас» пропустила бы документ, из-за которого касса провалится в минус в
// середине периода и вернётся в плюс к концу.
//
// Банк (1030) сознательно НЕ контролируем: овердрафт — законная ситуация.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

const CASH_ACCOUNT = "1010";

/** Документы, способные увести кассу в минус (кредит 1010). */
const CASH_OUT_DOC_TYPES = new Set(["cash_expense_order", "payroll_payment"]);

export class CashShortageError extends Error {
	constructor({ organizationUuid, date, shortage, balanceBefore, amount }) {
		const when = date ? new Date(date).toLocaleDateString("ru-RU") : "—";
		super(
			`Недостаточно денег в кассе: на ${when} остаток составит ${shortage.toFixed(2)} ₸. ` +
				`Доступно до операции: ${balanceBefore.toFixed(2)} ₸, требуется: ${amount.toFixed(2)} ₸.`,
		);
		this.name = "CashShortageError";
		this.organizationUuid = organizationUuid;
		this.shortage = shortage;
		this.balanceBefore = balanceBefore;
		this.amount = amount;
	}
}

/**
 * Остаток счёта 1010 по организации в хронологии, с учётом ПРЕДПОЛАГАЕМОГО
 * расхода, которого в проводках ещё нет.
 *
 * @returns {{min:number, atDate:Date|null, balanceBefore:number}} минимальный
 *   остаток за всю историю после вставки операции.
 */
async function projectCashBalance(
	{ organizationUuid, excludeDocumentUuid, prospective },
	client = prisma,
) {
	const entries = await client.accountingEntry.findMany({
		where: {
			organizationUuid,
			OR: [{ debitAccountCode: CASH_ACCOUNT }, { creditAccountCode: CASH_ACCOUNT }],
			// Перепроведение: собственные проводки документа не учитываем, иначе
			// расход посчитается дважды — старая версия плюс новая.
			...(excludeDocumentUuid ? { documentUuid: { not: excludeDocumentUuid } } : {}),
		},
		select: { date: true, amount: true, debitAccountCode: true, documentId: true, id: true },
		orderBy: [{ date: "asc" }, { documentId: "asc" }, { id: "asc" }],
	});

	const moves = entries.map((e) => ({
		date: new Date(e.date),
		delta: (e.debitAccountCode === CASH_ACCOUNT ? 1 : -1) * Number(e.amount),
	}));
	if (prospective && prospective.amount > 0) {
		moves.push({ date: new Date(prospective.date), delta: -prospective.amount });
	}
	moves.sort((a, b) => a.date - b.date);

	let balance = 0, min = Infinity, atDate = null, balanceBefore = 0;
	for (const m of moves) {
		// Остаток непосредственно перед проверяемой операцией — для текста ошибки.
		if (prospective && m.delta === -prospective.amount && +m.date === +new Date(prospective.date)) {
			balanceBefore = balance;
		}
		balance += m.delta;
		if (balance < min) { min = balance; atDate = m.date; }
	}
	return { min: min === Infinity ? 0 : min, atDate, balanceBefore };
}

/**
 * Бросает CashShortageError, если проведение документа уведёт кассу в минус.
 *
 * @param {string} documentType — тип документа.
 * @param {string} documentUuid — uuid (для исключения прежних проводок при перепроведении).
 * @param {object} doc — предполагаемое состояние документа: { organizationUuid, date, amount, paymentMethod }.
 */
export async function assertCashForPosting(documentType, documentUuid, doc, client = prisma) {
	if (!CASH_OUT_DOC_TYPES.has(documentType)) return;
	if (!doc?.organizationUuid) return;

	// Выплата зарплаты может идти через банк — тогда касса не затрагивается.
	if (documentType === "payroll_payment" && doc.paymentMethod && doc.paymentMethod !== "cash") return;

	const amount = Number(doc.amount ?? doc.total ?? 0);
	if (!(amount > 0)) return;

	const { min, atDate, balanceBefore } = await projectCashBalance(
		{ organizationUuid: doc.organizationUuid, excludeDocumentUuid: documentUuid, prospective: { date: doc.date ?? new Date(), amount } },
		client,
	);
	if (min < 0) {
		throw new CashShortageError({
			organizationUuid: doc.organizationUuid,
			date: atDate,
			shortage: min,
			balanceBefore,
			amount,
		});
	}
}

/** Маппинг CashShortageError → HTTP 409. Возвращает true, если ответ отправлен. */
export function respondCashError(err, res) {
	if (err instanceof CashShortageError) {
		res.status(409).json({
			success: false,
			message: err.message,
			cashShortage: { shortage: err.shortage, balanceBefore: err.balanceBefore, amount: err.amount },
		});
		return true;
	}
	return false;
}

export default { assertCashForPosting, respondCashError, CashShortageError };
