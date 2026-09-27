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
import { buildSnapshotsAt, deleteSnapshotsAfter } from "./costSnapshot.js";
import { withClusterLock } from "./clusterLock.js";

// Идущие пересчёты — ПО ОРГАНИЗАЦИИ (аудит 26.09). Раньше флаг был один на процесс:
// пересчёт организации A молча отменял авто-пересчёт организации B («already_recomputing»),
// и COGS у B оставался устаревшим. Межпроцессно пересчёт одной организации сериализует
// advisory-лок (withClusterLock) — воркеров в проде четыре.
const runningOrgs = new Set();
/** Идёт ли пересчёт (организации или хоть какой-то в этом процессе). */
export const isRecomputing = (organizationUuid = null) =>
	organizationUuid ? runningOrgs.has(organizationUuid) : runningOrgs.size > 0;
const orgKey = (organizationUuid) => organizationUuid ?? "__all__";
/** Имя межпроцессного лока пересчёта организации. */
export const recomputeLockName = (organizationUuid) => `recompute-costing:${orgKey(organizationUuid)}`;

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
	// раз меняет. Его место в хронологии и отбор по диапазону — по КОНЦУ ПЕРИОДА, а не
	// по дате документа: закрытие июня, сделанное 03.07, относится к июню (его проводки
	// датированы 30.06), и пересчёт хвоста после границы закрытия его не трогает.
	month_close: { model: "monthClose", dateField: "periodEnd" },
};

// При равной дате: приходы раньше расходов (как compareMovements в регистре), денежные
// документы после товарных, закрытие месяца — последним.
const PHASE_RANK = {
	purchase: 0, import_declaration: 0, goods_receipt: 0, sale_return: 0,
	inventory_transfer: 1,
	sale: 2, write_off: 2, purchase_return: 2,
	month_close: 9,
};
const rankOf = (type) => PHASE_RANK[type] ?? 5;

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

	/** Собрать документы указанных типов и упорядочить хронологически. */
	async function collect(types) {
		const docs = [];
		for (const type of types) {
			const cfg = MODEL_BY_TYPE[type];
			if (!cfg || !client[cfg.model]) continue;
			const dateField = cfg.dateField ?? "date";
			const rows = await client[cfg.model].findMany({
				where: { ...docWhere, ...(dateFilter ? { [dateField]: dateFilter } : {}), ...(cfg.where ?? {}) },
				select: { uuid: true, id: true, [dateField]: true },
			});
			for (const r of rows) docs.push({ type, uuid: r.uuid, date: r[dateField], id: r.id });
		}
		docs.sort((a, b) => {
			const d = new Date(a.date).getTime() - new Date(b.date).getTime();
			if (d !== 0) return d;
			const rk = rankOf(a.type) - rankOf(b.type);
			if (rk !== 0) return rk;
			if (a.type !== b.type) return a.type < b.type ? -1 : 1;
			return a.id - b.id;
		});
		return docs;
	}

	// Ошибка одного документа не обрывает пересчёт и не глушится: документ остаётся в
	// прежнем состоянии (его перепроведение атомарно), а список сбоев возвращается.
	const failed = [];
	async function phase(types, fn, extraArg) {
		const docs = await collect(types);
		for (const d of docs) {
			try {
				await fn(d.type, d.uuid, client, extraArg);
			} catch (err) {
				console.error(`recomputeCosting: ${d.type} ${d.uuid}:`, err?.message ?? err);
				failed.push({ documentType: d.type, documentUuid: d.uuid, message: String(err?.message ?? err) });
			}
		}
		return docs.length;
	}

	// Снапшоты себестоимости материализованы ИЗ регистра. ПОЛНЫЙ пересчёт (без
	// dateFilter) перестраивает и ЗАКРЫТУЮ историю → снапшоты на границе протухают,
	// а costing стартовал бы от устаревших слоёв. Поэтому удаляем их ДО фазы регистра.
	// Пересчёт хвоста ({ gt: boundary }) закрытую историю не трогает → снапшоты валидны.
	const fullRebuild = !dateFilter;
	if (fullRebuild) await deleteSnapshotsAfter(organizationUuid, null, client);

	const key = orgKey(organizationUuid);
	runningOrgs.add(key);
	try {
		// Порядок важен: регистр целиком (фаза мутирует регистр — БЕЗ общего кэша!),
		// затем проводки. На фазе проводок регистр НЕизменен, поэтому историю
		// себестоимости читаем один раз на весь пересчёт через общий costCache
		// (иначе каждый документ×строка перечитывал бы всю историю → O(история²)).
		const registers = await phase(REGISTER_DOC_TYPES, reconcileDocumentRegister);
		const entries = await phase(POSTING_DOC_TYPES, reconcileDocumentEntries, new Map());

		// Регистр перестроен → возвращаем материализацию на текущую границу, иначе
		// оптимизация осталась бы выключенной до следующего сохранения «Закрытия месяца».
		if (fullRebuild && organizationUuid) {
			const boundary = await getClosedBoundary(organizationUuid, client);
			if (boundary) await buildSnapshotsAt(organizationUuid, boundary, client);
		}
		return failed.length ? { registers, entries, failed } : { registers, entries };
	} finally {
		runningOrgs.delete(key);
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
 * В ФОНЕ, А НЕ В ЗАПРОСЕ (аудит 26.09). Раньше хвост пересчитывался синхронно на любой
 * PUT старого документа — даже правку комментария — и ответ мог не уложиться в таймаут
 * клиента. Теперь здесь только дешёвая проверка «ретроактив ли это», а сам пересчёт
 * ставится в очередь организации: запросы, пришедшие пока он идёт, сливаются в один
 * проход от самой ранней даты. Между воркерами пересчёт одной организации сериализует
 * advisory-лок; занят — повтор через RETRY_MS.
 *
 * @param {object} p
 * @param {boolean} [p.changed] — false: влияющие на себестоимость поля не менялись
 *   (см. costingFieldsChanged) — пересчёт не нужен.
 * @returns {Promise<{recomputed:boolean, scheduled?:boolean, reason?:string}>}
 */
export async function recomputeIfRetroactive({ organizationUuid, date, changed = true }, client = prisma) {
	if (!changed) return { recomputed: false, reason: "not_changed" };
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
	} catch (err) {
		// Проверка не должна ронять уже сохранённый документ.
		console.error("recomputeIfRetroactive error:", err.message);
		return { recomputed: false, reason: "error" };
	}
	scheduleRecompute(organizationUuid, docDate, client);
	return { recomputed: false, scheduled: true, reason: "scheduled" };
}

/** Пауза перед повтором, если пересчёт организации ведёт другой воркер. */
export const RETRY_MS = 5_000;
const queue = new Map(); // org → { from: Date, running: boolean, done: Promise }
let lockRunner = withClusterLock; // подменяется в тестах

/** Для тестов: подменить межпроцессный лок (name, run) → результат | undefined (занят). */
export function _setRecomputeLockRunner(fn) {
	lockRunner = fn ?? withClusterLock;
}

/**
 * Поставить пересчёт хвоста организации с даты `from` в очередь. Возвращает промис
 * завершения текущего прохода очереди (роутеры его не ждут; тесты — ждут).
 */
export function scheduleRecompute(organizationUuid, from, client = prisma) {
	let st = queue.get(organizationUuid);
	if (!st) { st = { from: null, running: false, done: null }; queue.set(organizationUuid, st); }
	if (!st.from || from < st.from) st.from = from;
	if (!st.running) {
		st.running = true;
		st.done = drain(organizationUuid, st, client).finally(() => { st.running = false; if (!st.from) queue.delete(organizationUuid); });
	}
	return st.done;
}

async function drain(organizationUuid, st, client) {
	while (st.from) {
		const from = st.from;
		st.from = null;
		try {
			// Закрытый период не трогаем: пересчитываем строго после его границы.
			const boundary = await getClosedBoundary(organizationUuid, client);
			const dateFilter = boundary && boundary >= from ? { gt: boundary } : { gte: from };
			const res = await lockRunner(recomputeLockName(organizationUuid), () => recomputeCosting({ organizationUuid, dateFilter }, client));
			if (res === undefined) {
				// Пересчёт этой организации ведёт другой процесс — наш запрос мог прийти
				// после того, как он собрал документы. Повторяем позже, а не теряем.
				if (!st.from || from < st.from) st.from = from;
				await new Promise((r) => setTimeout(r, RETRY_MS).unref?.());
			} else if (res?.failed?.length) {
				console.error(`recomputeCosting(${organizationUuid}): не пересчитано документов — ${res.failed.length}`);
			}
		} catch (err) {
			console.error("scheduled recomputeCosting error:", err?.message ?? err);
		}
	}
}

/**
 * Поменялось ли в документе что-то, влияющее на себестоимость и движения: дата,
 * проведение, склад(ы), организация. Правка комментария, номера, договора — нет.
 * Строки документа меняются своими роутерами (они и зовут пересчёт).
 */
export function costingFieldsChanged(existing, data) {
	const fields = ["date", "posted", "warehouseUuid", "fromWarehouseUuid", "toWarehouseUuid", "organizationUuid", "deletedAt", "basisDocumentUuid"];
	for (const f of fields) {
		if (data?.[f] === undefined) continue;
		const a = existing?.[f] instanceof Date ? existing[f].getTime() : existing?.[f] ?? null;
		const b = data[f] instanceof Date ? data[f].getTime() : data[f] ?? null;
		if (a !== b) return true;
	}
	return false;
}

export default { recomputeCosting, recomputeIfRetroactive, scheduleRecompute, costingFieldsChanged, unmappedDocTypes, isRecomputing, recomputeLockName };
