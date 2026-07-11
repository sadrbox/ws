// ─────────────────────────────────────────────────────────────────────────────
// Пересчёт себестоимости/проводок по проведённым документам (по запросу).
//
// Две фазы (как prisma/reconcile-all.js): сначала ПОЛНОСТЬЮ перестраиваем регистр
// товаров, затем бухпроводки. COGS реализации считается против УЖЕ полного
// регистра, поэтому корректно учитывает документы, введённые задним числом
// (ретроактив): достаточно перезапустить пересчёт после такого ввода.
//
// ПОРЯДОК ВНУТРИ ФАЗЫ — ХРОНОЛОГИЧЕСКИЙ, а не по типам документов. Стоимость
// движений ряда документов зависит от УЖЕ построенной части регистра:
//   inventory_transfer → себестоимость на складе-источнике;
//   write_off          → себестоимость на дату списания;
//   sale_return        → себестоимость на дату исходной продажи.
// Если пересобирать по типам, списание могло бы считаться раньше своего прихода
// и получить нулевую себестоимость. Сортировка (date, id) это исключает.
//
// Идемпотентно и обратимо: каждая фаза делает delete+rebuild из текущего
// состояния документов. Диапазон ограничивается, чтобы не трогать закрытые
// периоды (вызывающий передаёт dateFilter строго после границы закрытия).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";
import { reconcileDocumentRegister, REGISTER_DOC_TYPES } from "./productRegister.js";
import { reconcileDocumentEntries, POSTING_DOC_TYPES } from "./accountingPosting.js";
import { getClosedBoundary } from "./periodLock.js";

// Пересчёт сам вызывает reconcile* по каждому документу; без этого флага
// авто-триггер (recomputeIfRetroactive) запустил бы пересчёт из пересчёта.
let running = false;
export const isRecomputing = () => running;

// documentType → { model, where? }. ПКО и РКО делят одну модель cashOrder и
// различаются полем direction: без этого фильтра расходный ордер пересчитался бы
// по правилу приходного (и наоборот).
const MODEL_BY_TYPE = {
	purchase: { model: "purchase" },
	sale: { model: "sale" },
	inventory_transfer: { model: "inventoryTransfer" },
	sale_return: { model: "saleReturn" },
	purchase_return: { model: "purchaseReturn" },
	import_declaration: { model: "importDeclaration" },
	write_off: { model: "writeOff" },
	goods_receipt: { model: "goodsReceipt" },
	cash_receipt_order: { model: "cashOrder", where: { direction: "receipt" } },
	cash_expense_order: { model: "cashOrder", where: { direction: "expense" } },
	bank_statement: { model: "bankStatement" },
	payroll_calculation: { model: "payrollCalculation" },
	payroll_payment: { model: "payrollPayment" },
	// Закрытие месяца агрегирует обороты 6010/6280/7010/7210, которые пересчёт как
	// раз меняет. По дате (конец периода) оно естественно попадает в конец очереди.
	month_close: { model: "monthClose" },
};

/**
 * Типы документов, которые пересчёт НЕ обслуживает (нет модели в карте).
 * Экспортируется для теста-стража: реестры не должны разъезжаться при добавлении
 * новых документов-регистраторов.
 */
export function unmappedDocTypes() {
	const all = new Set([...REGISTER_DOC_TYPES, ...POSTING_DOC_TYPES]);
	return [...all].filter((t) => !MODEL_BY_TYPE[t]);
}

/**
 * @param {object} scope
 * @param {string|null} [scope.organizationUuid] — ограничить организацией.
 * @param {object|null} [scope.dateFilter] — Prisma-условие по полю date
 *        (например { gt: boundary } или { gte: fromDate }). null → без ограничения.
 * @param {object} [client] — prisma client/transaction.
 * @returns {Promise<{registers:number, entries:number}>} счётчики обработанных док-тов.
 */
export async function recomputeCosting({ organizationUuid = null, dateFilter = null } = {}, client = prisma) {
	const docWhere = { posted: true, deletedAt: null };
	if (organizationUuid) docWhere.organizationUuid = organizationUuid;
	if (dateFilter) docWhere.date = dateFilter;

	/** Собрать документы указанных типов и упорядочить хронологически. */
	async function collect(types) {
		const docs = [];
		for (const type of types) {
			const cfg = MODEL_BY_TYPE[type];
			if (!cfg || !client[cfg.model]) continue;
			const rows = await client[cfg.model].findMany({
				where: { ...docWhere, ...(cfg.where ?? {}) },
				select: { uuid: true, date: true, id: true },
			});
			for (const r of rows) docs.push({ type, uuid: r.uuid, date: r.date, id: r.id });
		}
		docs.sort((a, b) => {
			const d = new Date(a.date).getTime() - new Date(b.date).getTime();
			return d !== 0 ? d : a.id - b.id;
		});
		return docs;
	}

	async function phase(types, fn, extraArg) {
		const docs = await collect(types);
		for (const d of docs) await fn(d.type, d.uuid, client, extraArg);
		return docs.length;
	}

	running = true;
	try {
		// Порядок важен: регистр целиком (фаза мутирует регистр — БЕЗ общего кэша!),
		// затем проводки. На фазе проводок регистр НЕизменен, поэтому историю
		// себестоимости читаем один раз на весь пересчёт через общий costCache
		// (иначе каждый документ×строка перечитывал бы всю историю → O(история²)).
		const registers = await phase(REGISTER_DOC_TYPES, reconcileDocumentRegister);
		const entries = await phase(POSTING_DOC_TYPES, reconcileDocumentEntries, new Map());
		return { registers, entries };
	} finally {
		running = false;
	}
}

/**
 * Авто-пересчёт при вводе ЗАДНИМ ЧИСЛОМ.
 *
 * Себестоимость путезависима: документ, вставленный в середину истории, меняет
 * COGS всех ПОСЛЕДУЮЩИХ документов, но их проводки при этом не трогаются.
 * При средней ошибка размывается, при ФИФО расходится вся цепочка. Поэтому:
 * если по организации уже есть движения ПОЗЖЕ даты документа — пересчитываем
 * хвост истории (не залезая в закрытый период).
 *
 * Ничего не делает, если документ — самый поздний (обычный ввод «сегодня»),
 * поэтому в типовом сценарии стоит один дешёвый запрос.
 *
 * @returns {Promise<{recomputed:boolean, reason?:string, registers?:number, entries?:number}>}
 */
export async function recomputeIfRetroactive({ organizationUuid, date }, client = prisma) {
	if (running) return { recomputed: false, reason: "already_recomputing" };
	if (!organizationUuid || !date) return { recomputed: false, reason: "no_scope" };
	const docDate = new Date(date);
	if (isNaN(docDate.getTime())) return { recomputed: false, reason: "bad_date" };

	try {
		// Есть ли движения ПОЗЖЕ этого документа? Если нет — ввод не ретроактивный.
		const later = await client.productRegister.findFirst({
			where: { organizationUuid, date: { gt: docDate } },
			select: { id: true },
		});
		if (!later) return { recomputed: false, reason: "not_retroactive" };

		// Закрытый период не трогаем: пересчитываем строго после его границы.
		const boundary = await getClosedBoundary(organizationUuid, client);
		const dateFilter = boundary && boundary >= docDate ? { gt: boundary } : { gte: docDate };

		const res = await recomputeCosting({ organizationUuid, dateFilter }, client);
		return { recomputed: true, ...res };
	} catch (err) {
		// Пересчёт не должен ронять сохранение документа.
		console.error("recomputeIfRetroactive error:", err.message);
		return { recomputed: false, reason: "error" };
	}
}

export default { recomputeCosting, recomputeIfRetroactive, unmappedDocTypes, isRecomputing };
