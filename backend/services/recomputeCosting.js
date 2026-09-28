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
import { getSetting, setSetting } from "./appSettings.js";

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
	// Остановка процесса (stopRecomputes, КР-16 аудита 27.09) обрывает проход МЕЖДУ
	// документами: текущий доделывается, следующий не начинается — interrupted: true.
	const failed = [];
	let interrupted = false;
	async function phase(types, fn, extraArg) {
		const docs = await collect(types);
		for (const d of docs) {
			if (stopping) { interrupted = true; break; }
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
		const entries = interrupted ? 0 : await phase(POSTING_DOC_TYPES, reconcileDocumentEntries, new Map());
		if (interrupted) return { registers, entries, interrupted: true, ...(failed.length ? { failed } : {}) };

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
	// След — ДО постановки в очередь (КР-16): ответ 200 уйдёт, а пересчёт может не успеть.
	await markDirty(organizationUuid, docDate, client);
	scheduleRecompute(organizationUuid, docDate, client);
	return { recomputed: false, scheduled: true, reason: "scheduled" };
}

// ─── «Грязная дата» организации (КР-16 аудита 27.09) ─────────────────────────────
// БЫЛО. Очередь фонового пересчёта жила только в памяти процесса: правка задним числом
// отвечала 200, а деплой (pm2 restart) или падение воркера до или во время прохода теряли
// пересчёт хвоста без следа — COGS оставался устаревшим до ручного «Пересчитать».
// СТАЛО. Запрос сначала записывается в app_settings: `costing.dirtyFrom.<организация>` —
// самая ранняя дата, с которой хвост устарел. Проход берёт её под межпроцессным локом
// организации вместе с очередью в памяти и снимает только после прохода без сбоев — и
// только если за время прохода её не сменили. При старте процесса и раз в 6 ч непройденные
// отметки дообрабатываются (resumeDirtyRecomputes, server.js). Остановка процесса не рвёт
// проход посреди документа: он доделывает текущий и выходит, отметка остаётся.
// Окно гонки: две записи отметки одной организации из разных воркеров в одну и ту же
// миллисекунду могут оставить более позднюю дату — сам пересчёт при этом идёт в памяти
// отметившего воркера, теряется лишь след на случай его падения.
const DIRTY_PREFIX = "costing.dirtyFrom.";
/** Ключ отметки организации в app_settings. */
export const dirtyKey = (organizationUuid) => `${DIRTY_PREFIX}${organizationUuid}`;

let dirtyStore = null; // тесты: { get(key), set(key, value) }
/** Для тестов: подменить хранилище отметок (null — app_settings). */
export function _setDirtyStore(store) {
	dirtyStore = store ?? null;
}
// Отметка живёт в базе приложения — пишется только при работе через его основной клиент:
// тесты на мок-клиентах и сторонние клиенты чужую базу не трогают.
const storeFor = (client) => dirtyStore ?? (client === prisma ? { get: getSetting, set: setSetting } : null);
const parseDate = (v) => {
	const d = v ? new Date(v) : null;
	return d && !isNaN(d.getTime()) ? d : null;
};

/** Записать «грязную дату» организации, если она раньше уже записанной. Сбой — в журнал. */
async function markDirty(organizationUuid, from, client) {
	const store = storeFor(client);
	if (!store || !organizationUuid || !from) return;
	try {
		const cur = parseDate(await store.get(dirtyKey(organizationUuid)));
		if (!cur || from < cur) await store.set(dirtyKey(organizationUuid), from.toISOString());
	} catch (err) {
		console.error(`recomputeCosting: отметка пересчёта ${organizationUuid} не записана:`, err?.message ?? err);
	}
}

/** Отметить, что хвост организации с даты `from` нужно пересчитать (прерванный ручной пересчёт). */
export async function markRecomputeNeeded(organizationUuid, from, client = prisma) {
	await markDirty(organizationUuid, from instanceof Date ? from : parseDate(from), client);
}

// Остановка процесса: новые проходы не начинаются, идущие выходят после текущего документа.
let stopping = false;

/** Пауза перед повтором, если пересчёт организации ведёт другой воркер. */
export const RETRY_MS = 5_000;
const queue = new Map(); // org → { from: Date|null, adopt: boolean (взять дату из отметки), running: boolean, done: Promise }
let lockRunner = withClusterLock; // подменяется в тестах

/** Для тестов: подменить межпроцессный лок (name, run) → результат | undefined (занят). */
export function _setRecomputeLockRunner(fn) {
	lockRunner = fn ?? withClusterLock;
}

/**
 * Поставить пересчёт хвоста организации с даты `from` в очередь. Возвращает промис
 * завершения текущего прохода очереди (роутеры его не ждут; тесты — ждут).
 */
export function scheduleRecompute(organizationUuid, from, client = prisma, { adopt = false } = {}) {
	let st = queue.get(organizationUuid);
	if (!st) { st = { from: null, adopt: false, running: false, done: null }; queue.set(organizationUuid, st); }
	if (from && (!st.from || from < st.from)) st.from = from;
	if (adopt) st.adopt = true;
	// Процесс останавливается — проход не начинаем: отметка в базе дождётся следующего старта.
	if (stopping) return st.done ?? Promise.resolve();
	if (!st.running) {
		st.running = true;
		st.done = drain(organizationUuid, st, client).finally(() => { st.running = false; if (!st.from && !st.adopt) queue.delete(organizationUuid); });
	}
	return st.done;
}

async function drain(organizationUuid, st, client) {
	while ((st.from || st.adopt) && !stopping) {
		const from = st.from;
		const adopt = st.adopt;
		st.from = null;
		st.adopt = false;
		try {
			const res = await lockRunner(recomputeLockName(organizationUuid), () => runPass(organizationUuid, from, client));
			if (res === undefined) {
				// Пересчёт этой организации ведёт другой процесс — наш запрос мог прийти
				// после того, как он собрал документы. Повторяем позже, а не теряем.
				if (from && (!st.from || from < st.from)) st.from = from;
				if (adopt) st.adopt = true;
				if (stopping) break;
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
 * Один проход под межпроцессным локом организации: с самой ранней из дат — очереди в
 * памяти и отметки в базе (её мог оставить упавший или остановленный воркер). Отметка
 * снимается после прохода без сбоев, если за время прохода её не сменили.
 */
async function runPass(organizationUuid, queued, client) {
	const store = storeFor(client);
	let markRaw = null;
	if (store) {
		try {
			markRaw = await store.get(dirtyKey(organizationUuid));
		} catch (err) {
			console.error(`recomputeCosting: отметка пересчёта ${organizationUuid} не прочитана:`, err?.message ?? err);
		}
	}
	const from = [queued, parseDate(markRaw)].filter(Boolean).sort((a, b) => a - b)[0] ?? null;
	if (!from) return { registers: 0, entries: 0, skipped: true };
	// Закрытый период не трогаем: пересчитываем строго после его границы.
	const boundary = await getClosedBoundary(organizationUuid, client);
	const dateFilter = boundary && boundary >= from ? { gt: boundary } : { gte: from };
	const res = await recomputeCosting({ organizationUuid, dateFilter }, client);
	if (store && markRaw && !res.interrupted && !res.failed?.length) {
		try {
			if ((await store.get(dirtyKey(organizationUuid))) === markRaw) await store.set(dirtyKey(organizationUuid), null);
		} catch (err) {
			console.error(`recomputeCosting: отметка пересчёта ${organizationUuid} не снята:`, err?.message ?? err);
		}
	}
	return res;
}

/**
 * Дообработать непройденные отметки (старт процесса и раз в 6 ч — задача планировщика в
 * server.js): по каждой организации с отметкой ставится проход, который возьмёт дату из
 * отметки под локом (уже снятая другим воркером — пропуск).
 * @returns {Promise<number>} сколько организаций поставлено в пересчёт
 */
export async function resumeDirtyRecomputes(client = prisma) {
	const store = storeFor(client);
	if (!store || stopping) return 0;
	const orgs = await client.organization.findMany({ select: { uuid: true } });
	let n = 0;
	for (const o of orgs) {
		if (!parseDate(await store.get(dirtyKey(o.uuid)))) continue;
		scheduleRecompute(o.uuid, null, client, { adopt: true });
		n++;
	}
	return n;
}

/**
 * Остановка процесса (server.js): новые проходы не начинаются, идущие доделывают текущий
 * документ и выходят; отметки в базе остаются до следующего старта. Ждёт не дольше timeoutMs.
 * @returns {Promise<boolean>} true — все проходы завершились
 */
export async function stopRecomputes({ timeoutMs = 5_000 } = {}) {
	stopping = true;
	const running = [...queue.values()].map((st) => st.done).filter(Boolean);
	if (!running.length) return true;
	let timer = null;
	const expired = new Promise((r) => { timer = setTimeout(() => r(false), timeoutMs); timer.unref?.(); });
	const ok = await Promise.race([Promise.allSettled(running).then(() => true), expired]);
	clearTimeout(timer);
	return ok;
}

/** Для тестов: сбросить состояние (остановку и очередь). */
export function _resetRecomputeState() {
	stopping = false;
	queue.clear();
}

/**
 * Поля шапки, которые НЕ влияют на себестоимость и движения последующих документов.
 *
 * СПИСОК ИСКЛЮЧЕНИЙ, А НЕ СПИСОК ВЛИЯЮЩИХ (КР-9 аудита 27.09). Раньше перечислялись
 * влияющие поля (дата, проведение, склады, организация, основание), и о пошлинах ГТД никто
 * не вспомнил: пошлина 0→500 задним числом меняла регистр ГТД и проводку 1330/3390, а
 * себестоимость уже проданного оставалась прежней — и после фонового пересчёта, до ручного
 * «Пересчитать». Теперь влияет всё, кроме заведомо безразличного: реквизиты, по которым
 * себестоимость не считается, и служебные отметки. Контрагент, договор и менеджер попадают
 * только в аналитику проводок САМОГО документа (они пересобираются в его транзакции), а
 * хвост от них не зависит. Лишний пересчёт стоит только времени, пропущенный — неверного COGS.
 */
export const NON_COSTING_FIELDS = new Set([
	"id", "uuid", "number", "comment", "authorUuid", "createdAt", "updatedAt",
	"counterpartyUuid", "contractUuid", "managerUuid", "priceTypeUuid", "basisDocumentLabel",
	// ГТД: реквизиты декларации (суммы платежей — влияют).
	"declarationNumber", "declarationDate", "countryCode",
	// Обмен с ИС ЭСФ (ЭАВР, СНТ): статусы и ссылки.
	"awpStatus", "awpId", "awpRegistrationNumber", "awpSentAt", "awpErrorText", "awpXml", "awpRelatedUuid",
	"sntStatus", "sntId", "sntRegistrationNumber", "sntSentAt", "sntErrorText", "sntXml", "sntRelatedUuid",
]);

/** Значение поля для сравнения: дата и Decimal — числом, пусто — null. */
function comparable(v) {
	if (v === undefined || v === null) return null;
	if (v instanceof Date) return v.getTime();
	if (typeof v === "object" && typeof v.toNumber === "function") return v.toNumber(); // Prisma.Decimal
	return v;
}

/** Одинаковы ли значения поля (Decimal/число/строка числа из тела, дата/ISO-строка). */
function sameValue(a, b) {
	const x = comparable(a);
	const y = comparable(b);
	if (x === y) return true;
	if (x === null || y === null) return false;
	const asNumber = (s) => {
		if (typeof s !== "string" || !s.trim()) return NaN;
		const n = Number(s);
		return Number.isFinite(n) ? n : Date.parse(s);
	};
	if (typeof x === "number" && typeof y === "string") return asNumber(y) === x;
	if (typeof y === "number" && typeof x === "string") return asNumber(x) === y;
	return false;
}

/**
 * Поменялось ли в документе что-то, влияющее на себестоимость и движения последующих
 * документов: любое поле из `data`, кроме NON_COSTING_FIELDS, со значением, отличным от
 * `existing`. Поля, которого в `existing` нет (роутер выбрал шапку не целиком), считается
 * изменившимся — лучше лишний пересчёт, чем пропущенный. Строки документа меняются своими
 * роутерами (они и зовут пересчёт).
 */
export function costingFieldsChanged(existing, data) {
	for (const [f, v] of Object.entries(data ?? {})) {
		if (v === undefined || NON_COSTING_FIELDS.has(f)) continue;
		if (!existing || !(f in existing)) return true;
		if (!sameValue(existing[f], v)) return true;
	}
	return false;
}

export default { recomputeCosting, recomputeIfRetroactive, scheduleRecompute, resumeDirtyRecomputes, stopRecomputes, markRecomputeNeeded, costingFieldsChanged, unmappedDocTypes, isRecomputing, recomputeLockName };
