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
import { orgTimeZone } from "./periodBounds.js";

const CASH_ACCOUNT = "1010";

/** Документы, способные увести кассу в минус (кредит 1010). */
const CASH_OUT_DOC_TYPES = new Set(["cash_expense_order", "payroll_payment"]);
/** Приход в кассу: его распроведение, удаление, уменьшение или перенос позже — тоже риск (аудит 26.09). */
const CASH_IN_DOC_TYPES = new Set(["cash_receipt_order"]);

const EPS = 0.005;

export class CashShortageError extends Error {
	constructor({ organizationUuid, date, shortage, balanceBefore, amount, removal = false }) {
		const when = date ? new Date(date).toLocaleDateString("ru-RU", { timeZone: orgTimeZone(organizationUuid) }) : "—";
		super(
			removal
				? `Недостаточно денег в кассе: без этого поступления остаток на ${when} составит ${shortage.toFixed(2)} ₸ — ` +
					`из этих денег уже выдано. Сначала распроведите или измените более поздние расходы.`
				: `Недостаточно денег в кассе: на ${when} остаток составит ${shortage.toFixed(2)} ₸. ` +
					`Доступно до операции: ${balanceBefore.toFixed(2)} ₸, требуется: ${amount.toFixed(2)} ₸.`,
		);
		this.name = "CashShortageError";
		this.organizationUuid = organizationUuid;
		this.shortage = shortage;
		this.balanceBefore = balanceBefore;
		this.amount = amount;
	}
}

/** Знак движения документа по кассе: +1 приход, −1 расход, 0 — не касается кассы. */
function cashSign(documentType, doc) {
	if (CASH_IN_DOC_TYPES.has(documentType)) return 1;
	if (!CASH_OUT_DOC_TYPES.has(documentType)) return 0;
	// Выплата зарплаты может идти через банк — тогда касса не затрагивается.
	if (documentType === "payroll_payment" && doc?.paymentMethod && doc.paymentMethod !== "cash") return 0;
	return -1;
}

/**
 * Остаток счёта 1010 организации в хронологии — в двух сценариях: как сейчас (с
 * проводками документа по кассе) и после изменения (с предполагаемым движением).
 *
 * ПОЧЕМУ НЕ «МИНИМУМ ПО ВСЕЙ ИСТОРИИ» (аудит 26.09). Раньше проверка брала минимум
 * остатка за всю историю: один старый провал (например, до ввода остатков) навсегда
 * блокировал любой РКО, даже на 10 ₸ при остатке 999 500. Теперь смотрим только моменты
 * НАЧИНАЯ с самой ранней затронутой даты и отказываем, лишь если остаток там уходит в
 * минус И становится хуже, чем без изменения: изменение не должно создавать или углублять
 * нехватку, а к чужому старому провалу оно не причастно.
 *
 * @returns {{violation: null | {min:number, atDate:Date, balanceBefore:number}}}
 */
async function projectCashChange({ organizationUuid, documentUuid, next }, client = prisma) {
	const own = documentUuid
		? await client.accountingEntry.findMany({
			where: { organizationUuid, documentUuid, OR: [{ debitAccountCode: CASH_ACCOUNT }, { creditAccountCode: CASH_ACCOUNT }] },
			select: { date: true, amount: true, debitAccountCode: true },
		})
		: [];
	const oldMoves = own.map((e) => ({ date: new Date(e.date), delta: (e.debitAccountCode === CASH_ACCOUNT ? 1 : -1) * Number(e.amount), src: "old" }));
	const newMoves = next && next.delta ? [{ date: new Date(next.date), delta: next.delta, src: "new" }] : [];
	if (!oldMoves.length && !newMoves.length) return { violation: null };
	const tmin = new Date(Math.min(...[...oldMoves, ...newMoves].map((m) => m.date.getTime())));

	const notOwn = documentUuid ? { documentUuid: { not: documentUuid } } : {};
	// Остаток до tmin — агрегатом; движения с tmin — построчно.
	// Последовательно: проверку могут звать и внутри транзакции (одно соединение).
	const inBefore = await client.accountingEntry.aggregate({ where: { organizationUuid, debitAccountCode: CASH_ACCOUNT, date: { lt: tmin }, ...notOwn }, _sum: { amount: true } });
	const outBefore = await client.accountingEntry.aggregate({ where: { organizationUuid, creditAccountCode: CASH_ACCOUNT, date: { lt: tmin }, ...notOwn }, _sum: { amount: true } });
	const rows = await client.accountingEntry.findMany({
		where: { organizationUuid, date: { gte: tmin }, OR: [{ debitAccountCode: CASH_ACCOUNT }, { creditAccountCode: CASH_ACCOUNT }], ...notOwn },
		select: { date: true, amount: true, debitAccountCode: true },
	});
	const start = (Number(inBefore?._sum?.amount) || 0) - (Number(outBefore?._sum?.amount) || 0);
	const moves = [
		...rows.map((e) => ({ date: new Date(e.date), delta: (e.debitAccountCode === CASH_ACCOUNT ? 1 : -1) * Number(e.amount), src: "base" })),
		...oldMoves,
		...newMoves,
	];
	// В один момент — сначала поступления, потом выдачи (как приход раньше расхода на складе).
	moves.sort((a, b) => (a.date - b.date) || (b.delta > 0) - (a.delta > 0));

	let balOld = start;
	let balNew = start;
	let worst = null;
	let beforeNew = null;
	for (const m of moves) {
		if (m.src === "new" && beforeNew === null) beforeNew = balNew;
		if (m.src !== "new") balOld += m.delta;
		if (m.src !== "old") balNew += m.delta;
		if (balNew < -EPS && balNew < balOld - EPS && (worst === null || balNew < worst.min)) worst = { min: balNew, atDate: m.date };
	}
	return { violation: worst ? { ...worst, balanceBefore: beforeNew ?? balNew } : null };
}

/**
 * Бросает CashShortageError, если изменение документа уведёт кассу в минус.
 *
 * Работает и для расхода (РКО, выплата зарплаты наличными), и для прихода (ПКО):
 * распроведение, удаление, уменьшение суммы или перенос ПКО на более позднюю дату — тоже
 * могут оставить уже выданные деньги без источника.
 *
 * @param {string} documentType — тип документа.
 * @param {string|null} documentUuid — uuid (его текущие проводки по кассе — «до изменения»).
 * @param {object|null} doc — состояние ПОСЛЕ изменения: { organizationUuid, date, amount,
 *   paymentMethod, posted }. posted=false или doc=null — документ перестаёт двигать кассу.
 */
export async function assertCashForPosting(documentType, documentUuid, doc, client = prisma) {
	const sign = cashSign(documentType, doc);
	if (!sign) return;
	const organizationUuid = doc?.organizationUuid;
	if (!organizationUuid) return;
	const amount = Number(doc.amount ?? doc.total ?? 0);
	const moves = doc && doc.posted !== false && amount > 0;
	const next = moves ? { date: doc.date ?? new Date(), delta: sign * amount } : null;
	const { violation } = await projectCashChange({ organizationUuid, documentUuid, next }, client);
	if (violation) {
		throw new CashShortageError({
			organizationUuid,
			date: violation.atDate,
			shortage: violation.min,
			balanceBefore: violation.balanceBefore,
			amount,
			removal: sign > 0,
		});
	}
}

/** Изменение/удаление документа по кассе (удаление — doc с posted:false). Синоним для ясности вызовов. */
export const assertCashAfterChange = assertCashForPosting;

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

export default { assertCashForPosting, assertCashAfterChange, respondCashError, CashShortageError };
