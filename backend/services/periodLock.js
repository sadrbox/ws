// ─────────────────────────────────────────────────────────────────────────────
// Блокировка закрытых периодов.
//
// После проведения документа «Закрытие месяца» (month_close) период до его
// periodEnd считается закрытым: дотированные документы организации с датой ≤
// границы нельзя создавать / изменять / удалять. Граница = максимальный periodEnd
// среди проведённых (posted=true, не удалённых) закрытий организации, взятый на
// КОНЕЦ дня (23:59:59.999) — согласованно с правилом закрытия, которое суммирует
// обороты до конца последнего дня периода (см. accountingPosting.js → month_close).
//
// Escape-hatch: сам month_close ИСКЛЮЧён из проверки (его нет в PERIOD_LOCKED_MODELS),
// чтобы можно было переоткрыть период — удалить/распровести закрытие и закрыть заново.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

// Prisma-модели дотированных документов, попадающих под блокировку. БЕЗ monthClose.
export const PERIOD_LOCKED_MODELS = new Set([
	"sale",
	"purchase",
	"saleReturn",
	"purchaseReturn",
	"inventoryTransfer",
	"cashOrder",
	"bankStatement",
	"payrollCalculation",
	"payrollPayment",
	"salesOrder",
	"purchaseOrder",
	"commercialOffer",
	"reservation",
	"importDeclaration",
	"writeOff",
	"goodsReceipt",
	"stockCount",
]);

// Лёгкий TTL-кэш границы по организации (запрос дешёвый, но мутации частые).
const BOUNDARY_TTL_MS = 5000;
const boundaryCache = new Map(); // orgUuid → { value: Date|null, ts: number }

/** Сбросить кэш границ (вызывать при изменении month_close, если нужно мгновенно). */
export function invalidateClosedBoundary(orgUuid = null) {
	if (orgUuid) boundaryCache.delete(orgUuid);
	else boundaryCache.clear();
}

/**
 * Граница закрытого периода организации: конец дня максимального periodEnd среди
 * проведённых закрытий. null — закрытий нет (период не закрыт).
 * @returns {Promise<Date|null>}
 */
export async function getClosedBoundary(orgUuid, client = prisma) {
	if (!orgUuid) return null;
	const cached = boundaryCache.get(orgUuid);
	if (cached && Date.now() - cached.ts < BOUNDARY_TTL_MS) return cached.value;

	let value = null;
	try {
		const agg = await client.monthClose.aggregate({
			where: { organizationUuid: orgUuid, posted: true, deletedAt: null },
			_max: { periodEnd: true },
		});
		const end = agg?._max?.periodEnd ?? null;
		if (end) {
			value = new Date(end);
			value.setHours(23, 59, 59, 999); // включительно по последний день периода
		}
	} catch (err) {
		// Нет таблицы/ошибка — считаем период открытым (не блокируем по ошибке инфраструктуры).
		console.error("getClosedBoundary error:", err);
		value = null;
	}
	boundaryCache.set(orgUuid, { value, ts: Date.now() });
	return value;
}

// ─── Ошибка блокировки ───────────────────────────────────────────────────────
export class PeriodLockedError extends Error {
	constructor(message) {
		super(message);
		this.name = "PeriodLockedError";
		this.errors = [message];
	}
}

const fmtDate = (d) => {
	const dd = String(d.getDate()).padStart(2, "0");
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	return `${dd}.${mm}.${d.getFullYear()}`;
};

/**
 * Бросает PeriodLockedError, если документ организации `orgUuid` с датой `date`
 * попадает в закрытый период (date ≤ граница). Если org/date не заданы или
 * закрытий нет — ничего не делает.
 */
export async function assertPeriodOpen(orgUuid, date, client = prisma) {
	if (!orgUuid || !date) return;
	const boundary = await getClosedBoundary(orgUuid, client);
	if (!boundary) return;
	const d = date instanceof Date ? date : new Date(date);
	if (isNaN(d.getTime())) return;
	if (d.getTime() <= boundary.getTime()) {
		throw new PeriodLockedError(
			`Период закрыт: дата документа ≤ даты запрета изменений (${fmtDate(boundary)}). ` +
			`Распроведите или удалите документ «Закрытие месяца», чтобы изменить этот период.`,
		);
	}
}

/** Маппинг PeriodLockedError → HTTP 423 Locked. Возвращает true, если ответ отправлен. */
export function respondPeriodLockError(err, res) {
	if (err instanceof PeriodLockedError) {
		res.status(423).json({ success: false, message: err.message, errors: err.errors });
		return true;
	}
	return false;
}

export default {
	PERIOD_LOCKED_MODELS,
	getClosedBoundary,
	invalidateClosedBoundary,
	assertPeriodOpen,
	PeriodLockedError,
	respondPeriodLockError,
};
