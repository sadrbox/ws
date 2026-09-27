// ─────────────────────────────────────────────────────────────────────────────
// Блокировка закрытых периодов.
//
// После проведения документа «Закрытие месяца» (month_close) период до его
// periodEnd считается закрытым: дотированные документы организации с датой ≤
// границы нельзя создавать / изменять / удалять. Граница = максимальный periodEnd
// среди проведённых (posted=true, не удалённых) закрытий организации, взятый на
// КОНЕЦ дня (23:59:59.999) В ПОЯСЕ ОРГАНИЗАЦИИ — той же функцией periodBounds, что и
// правило закрытия (см. accountingPosting.js → month_close), чтобы граница запрета и
// обороты закрытия совпадали до миллисекунды (У5 аудита 26.09).
//
// Escape-hatch: сам month_close ИСКЛЮЧён из проверки (его нет в PERIOD_LOCKED_MODELS),
// чтобы можно было переоткрыть период — удалить/распровести закрытие и закрыть заново.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { endOfLocalDay, orgTimeZone } from "./periodBounds.js";
import { onCacheInvalidate } from "./cacheBus.js";

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

function invalidateLocal(orgUuid) {
	if (orgUuid) boundaryCache.delete(orgUuid);
	else boundaryCache.clear();
}

// Кэш живёт в каждом воркере (Н7 аудита 26.09): сброс рассылается всем через шину, иначе
// соседний воркер до 5 с пропускал бы правку только что закрытого периода.
const broadcastInvalidate = onCacheInvalidate("closedBoundary", invalidateLocal);

/** Сбросить кэш границ (вызывать при изменении month_close) — во всех воркерах. */
export function invalidateClosedBoundary(orgUuid = null) {
	invalidateLocal(orgUuid);
	broadcastInvalidate(orgUuid);
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

	// Ошибку БД НЕ глушим (У9 аудита 26.09): раньше сбой запроса означал «период открыт»,
	// и правка закрытого месяца проходила ровно тогда, когда проверить её было нечем.
	// Теперь сбой уходит вызывающему — запрос получает ошибку, а в кэш ничего не пишется.
	const agg = await client.monthClose.aggregate({
		where: { organizationUuid: orgUuid, posted: true, deletedAt: null },
		_max: { periodEnd: true },
	});
	const end = agg?._max?.periodEnd ?? null;
	// Включительно по последний день периода — конец местных суток организации.
	const value = end ? endOfLocalDay(end, orgTimeZone(orgUuid)) : null;
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

// Дата границы для сообщения — местная дата организации, а не сервера.
const fmtDate = (d, tz) =>
	new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

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
			`Период закрыт: дата документа ≤ даты запрета изменений (${fmtDate(boundary, orgTimeZone(orgUuid))}). ` +
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
