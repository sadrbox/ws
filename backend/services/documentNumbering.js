// ─────────────────────────────────────────────────────────────────────────────
// Нумерация документов. Человекочитаемый номер вида «<ПРЕФИКС>-<NNNNNN>» со
// сквозным счётчиком по организации + виду документа + году (сброс с начала
// года). Номер можно задать вручную в payload (тогда автогенерация не нужна) —
// напр. при импорте из старой системы.
//
// Префиксы видов документов заданы в коде (NUMBER_CONFIG) — отдельного UI
// настроек не требуется.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../prisma/prisma-client.js";

// docType → { префикс по умолчанию, человекочитаемая метка }.
// Префикс можно переопределить в настройках (таблица document_number_settings,
// экран «Настройки → Нумерация документов»).
export const NUMBER_CONFIG = {
	sale: { prefix: "РЕАЛ", label: "Реализация" },
	purchase: { prefix: "ПОСТ", label: "Поступление" },
	sale_return: { prefix: "ВЗПК", label: "Возврат от покупателя" },
	purchase_return: { prefix: "ВЗПС", label: "Возврат поставщику" },
	inventory_transfer: { prefix: "ПЕРЕМ", label: "Перемещение" },
	cash_receipt_order: { prefix: "ПКО", label: "Приходный кассовый ордер" },
	cash_expense_order: { prefix: "РКО", label: "Расходный кассовый ордер" },
	bank_statement: { prefix: "БВ", label: "Банковская выписка" },
	commercial_offer: { prefix: "КП", label: "Коммерческое предложение" },
	sales_order: { prefix: "ЗАКП", label: "Заказ покупателя" },
	reservation: { prefix: "РЕЗ", label: "Резервирование" },
	outgoing_invoice: { prefix: "СФ", label: "Счёт-фактура (исх.)" },
	incoming_invoice: { prefix: "СФВ", label: "Счёт-фактура (вх.)" },
	payment_invoice: { prefix: "СЧ", label: "Счёт на оплату" },
	purchase_order: { prefix: "ЗАКС", label: "Заказ поставщику" },
	purchase_requisition: { prefix: "ЗАЯВ", label: "Заявка на закупку" },
	payroll_calculation: { prefix: "НЗП", label: "Начисление зарплаты" },
	payroll_payment: { prefix: "ВЗП", label: "Выплата зарплаты" },
	price_setting: { prefix: "ЦЕН", label: "Установка цен номенклатуры" },
	month_close: { prefix: "ЗМ", label: "Закрытие месяца" },
};

export const GLOBAL_SETTINGS_KEY = "__global__";

// Кэш переопределений префиксов по организации (короткий TTL).
const _cache = new Map(); // orgKey → { map, at }
const SETTINGS_TTL = 15_000;

/**
 * Карта docType → {prefix, enabled} для организации: глобальные значения
 * («__global__») переопределяются настройками самой организации.
 */
async function loadSettings(client, orgUuid) {
	const orgKey = orgUuid || GLOBAL_SETTINGS_KEY;
	const now = Date.now();
	const cached = _cache.get(orgKey);
	if (cached && now - cached.at < SETTINGS_TTL) return cached.map;
	const map = {};
	try {
		const orgs = orgKey === GLOBAL_SETTINGS_KEY ? [GLOBAL_SETTINGS_KEY] : [GLOBAL_SETTINGS_KEY, orgKey];
		const rows = await client.documentNumberSetting.findMany({ where: { organizationUuid: { in: orgs } } });
		// Сначала глобальные, затем — настройки организации (имеют приоритет).
		for (const r of rows) if (r.organizationUuid === GLOBAL_SETTINGS_KEY) map[r.docType] = { prefix: r.prefix, enabled: r.enabled };
		if (orgKey !== GLOBAL_SETTINGS_KEY)
			for (const r of rows) if (r.organizationUuid === orgKey) map[r.docType] = { prefix: r.prefix, enabled: r.enabled };
	} catch {
		/* нет таблицы/ошибка — используем дефолты из NUMBER_CONFIG */
	}
	_cache.set(orgKey, { map, at: now });
	return map;
}

/** Сбросить кэш настроек (вызывать после изменения настроек нумерации). */
export function invalidateNumberSettingsCache() {
	_cache.clear();
}

/**
 * Ключ счётчика document_sequences: вид документа + префикс. Префиксы ведут
 * НЕЗАВИСИМЫЕ ряды («sale#РЕАЛ» vs «sale#» без префикса) — без миграции схемы
 * (хранится в колонке docType). journalMaxForYear (фильтр по префиксу) подхватит
 * фактический максимум ряда, поэтому смена ключа безопасна (самовосстановление).
 */
function sequenceKey(docType, prefix) {
	return `${docType}#${(prefix ?? "").trim()}`;
}

/**
 * Выделяет следующий номер документа (атомарно увеличивает счётчик).
 * @returns {Promise<string|null>} номер «ПРЕФИКС-000123» или null (нет конфига).
 */
export async function allocateNumber(docType, organizationUuid, date, client = prisma) {
	const def = NUMBER_CONFIG[docType];
	if (!def) return null;
	const settings = await loadSettings(client, organizationUuid);
	// Нумерация используется для всех документов всегда: настраиваются только
	// префикс и разрядность. Отключения нумерации нет (поле «Номер» обязательно).
	// Префикс опционален: по умолчанию его нет, номер — только дополненный нулями
	// счётчик («000000001»). Префикс добавляется через «-», только если задан.
	const prefix = (settings[docType]?.prefix ?? "").trim();
	const year = (date ? new Date(date) : new Date()).getFullYear();
	const org = organizationUuid || GLOBAL_SETTINGS_KEY;
	// Префикс — ОТДЕЛЬНАЯ последовательность: «РЕАЛ-…» и «…» (без префикса) ведут
	// РАЗНЫЕ ряды. Кодируем префикс в ключе счётчика (без миграции схемы).
	const key = sequenceKey(docType, prefix);
	try {
		// Самовосстановление: счётчик не должен отставать от ручного ввода/импорта.
		const jmax = await journalMaxForYear(docType, organizationUuid, year, prefix, client);
		// Атомарно одним SQL: lastValue = GREATEST(текущий, journalMax) + 1 (без гонок).
		const rows = await client.$queryRawUnsafe(
			`INSERT INTO "document_sequences" ("organizationUuid","docType","year","lastValue")
			 VALUES ($1,$2,$3,$4 + 1)
			 ON CONFLICT ("organizationUuid","docType","year")
			 DO UPDATE SET "lastValue" = GREATEST("document_sequences"."lastValue", $4) + 1, "updatedAt" = now()
			 RETURNING "lastValue"`,
			org, key, year, jmax,
		);
		// ХРАНЕНИЕ и ОТОБРАЖЕНИЕ без ведущих нулей: числовая часть как есть.
		const seq = String(rows[0].lastValue);
		return prefix ? `${prefix}-${seq}` : seq;
	} catch (err) {
		console.error(`allocateNumber(${docType}) error:`, err);
		return null;
	}
}

// docType → таблица журнала (+ direction для cash_orders). Имена фиксированы в
// коде (НЕ из ввода) → безопасны для подстановки в SQL. Нужны для самовос-
// становления счётчика по фактическому максимуму номеров за год.
const DOC_JOURNAL = {
	sale: { table: "sales" },
	purchase: { table: "purchases" },
	sale_return: { table: "sale_returns" },
	purchase_return: { table: "purchase_returns" },
	inventory_transfer: { table: "inventory_transfers" },
	cash_receipt_order: { table: "cash_orders", direction: "receipt" },
	cash_expense_order: { table: "cash_orders", direction: "expense" },
	outgoing_invoice: { table: "outgoing_invoices" },
	incoming_invoice: { table: "incoming_invoices" },
	payment_invoice: { table: "payment_invoices" },
	sales_order: { table: "sales_orders" },
	purchase_order: { table: "purchase_orders" },
	commercial_offer: { table: "commercial_offers" },
	reservation: { table: "reservations" },
	purchase_requisition: { table: "purchase_requisitions" },
	month_close: { table: "month_closes" },
};

/**
 * Занят ли номер в серии за год другим документом (кроме excludeUuid)? Учитывает
 * direction (ПКО/РКО — независимые ряды). Для кнопки «Присвоить номер»: если
 * приведённый к настройкам номер уже занят (напр. после смены префикса старый
 * «ПКО-000001» → «000001» совпал с новым «000001») — выдать следующий свободный.
 * @returns {Promise<boolean>}
 */
export async function isNumberTaken(docType, number, organizationUuid, date, excludeUuid, client = prisma) {
	const j = DOC_JOURNAL[docType];
	// Сравнение по нормализованному значению (без ведущих нулей): «00074» == «74».
	const num = normalizeDocNumber(number);
	if (!j || !num) return false;
	const year = (date ? new Date(date) : new Date()).getFullYear();
	const params = [num];
	let where = `"number" = $1 AND "deletedAt" IS NULL`;
	if (j.direction) where += ` AND "direction" = '${j.direction}'`;
	if (organizationUuid) { params.push(organizationUuid); where += ` AND "organizationUuid" = $${params.length}`; }
	params.push(new Date(year, 0, 1)); where += ` AND "date" >= $${params.length}`;
	params.push(new Date(year + 1, 0, 1)); where += ` AND "date" < $${params.length}`;
	if (excludeUuid) { params.push(excludeUuid); where += ` AND "uuid" <> $${params.length}`; }
	try {
		const rows = await client.$queryRawUnsafe(`SELECT 1 FROM "${j.table}" WHERE ${where} LIMIT 1`, ...params);
		return rows.length > 0;
	} catch (err) {
		console.error(`isNumberTaken(${docType}) error:`, err);
		return false;
	}
}

/**
 * Возвращает текущий номер документа из БД по uuid (для кнопки «Присвоить номер»:
 * если поле очищено, надо переиспользовать СВОЙ номер, а не выдать следующий).
 * @returns {Promise<string|null>}
 */
export async function lookupDocumentNumber(docType, uuid, client = prisma) {
	const j = DOC_JOURNAL[docType];
	if (!j || !uuid) return null;
	try {
		const rows = await client.$queryRawUnsafe(`SELECT "number" FROM "${j.table}" WHERE "uuid" = $1`, uuid);
		return rows?.[0]?.number ?? null;
	} catch (err) {
		console.error(`lookupDocumentNumber(${docType}) error:`, err);
		return null;
	}
}

/**
 * Максимальный ЧИСЛОВОЙ номер в журнале за КАЛЕНДАРНЫЙ ГОД (по полю date) для
 * текущей последовательности (того же префикса). Устойчив к «грязным» данным:
 * учитываются только номера нужного ряда («P-цифры» при префиксе P, либо чистые
 * цифры без префикса). Нужен, чтобы счётчик догонял ручной ввод/импорт.
 * @returns {Promise<number>} максимум или 0.
 */
export async function journalMaxForYear(docType, organizationUuid, year, prefix, client = prisma) {
	const j = DOC_JOURNAL[docType];
	if (!j) return 0;
	const params = [];
	let where = `"deletedAt" IS NULL AND "number" IS NOT NULL`;
	if (j.direction) where += ` AND "direction" = '${j.direction}'`;
	if (organizationUuid) { params.push(organizationUuid); where += ` AND "organizationUuid" = $${params.length}`; }
	params.push(new Date(year, 0, 1)); const ys = `$${params.length}`;
	params.push(new Date(year + 1, 0, 1)); const ye = `$${params.length}`;
	where += ` AND "date" >= ${ys} AND "date" < ${ye}`;
	let maxExpr;
	if (prefix) {
		params.push(prefix); const p = `$${params.length}`;
		maxExpr = `MAX(CASE WHEN starts_with("number", ${p} || '-')
		                AND substring("number" from char_length(${p}) + 2) ~ '^[0-9]+$'
		               THEN substring("number" from char_length(${p}) + 2)::bigint END)`;
	} else {
		maxExpr = `MAX(CASE WHEN "number" ~ '^[0-9]+$' THEN "number"::bigint END)`;
	}
	try {
		const rows = await client.$queryRawUnsafe(
			`SELECT COALESCE(${maxExpr}, 0) AS maxnum FROM "${j.table}" WHERE ${where}`,
			...params,
		);
		return Number(rows?.[0]?.maxnum ?? 0);
	} catch (err) {
		console.error(`journalMaxForYear(${docType}) error:`, err);
		return 0;
	}
}

/**
 * Предпросмотр следующего номера БЕЗ изменения счётчика (для кнопки «Присвоить
 * номер»). Использует ТОТ ЖЕ источник, что и allocateNumber: max(счётчик,
 * максимум журнала за год) + 1 — поэтому превью совпадает с тем, что реально
 * присвоится при сохранении.
 * @returns {Promise<string|null>} номер или null (нет конфига/нумерация выключена).
 */
export async function peekNextNumber(docType, organizationUuid, date, client = prisma) {
	const def = NUMBER_CONFIG[docType];
	if (!def) return null;
	const settings = await loadSettings(client, organizationUuid);
	// ВАЖНО: enabled здесь НЕ проверяем. enabled управляет АВТОприсвоением при
	// сохранении (allocateNumber), а кнопка «Присвоить номер» — явное действие
	// пользователя: предлагаем следующий номер даже при выключенной автонумерации.
	const prefix = (settings[docType]?.prefix ?? "").trim();
	const year = (date ? new Date(date) : new Date()).getFullYear();
	const org = organizationUuid || GLOBAL_SETTINGS_KEY;
	let last = 0;
	try {
		const row = await client.documentSequence.findUnique({
			where: { organizationUuid_docType_year: { organizationUuid: org, docType: sequenceKey(docType, prefix), year } },
			select: { lastValue: true },
		});
		last = row?.lastValue ?? 0;
	} catch { /* нет строки/таблицы — стартуем с максимума журнала */ }
	const jmax = await journalMaxForYear(docType, organizationUuid, year, prefix, client);
	return formatDocNumber(prefix, Math.max(last, jmax) + 1);
}

/**
 * Откатывает счётчик последовательности к фактическому максимуму ОСТАВШИХСЯ
 * документов за год — вызывать ПОСЛЕ удаления документа. Освобождает номер
 * удалённого «верхнего» документа: следующий номер переиспользует его, счётчик
 * не уходит вперёд. (Удаление документа из середины ряда оставляет пропуск —
 * это неизбежно; переиспользуется только освободившийся максимум.)
 *
 * @param {string} docType   вид удалённого документа
 * @param {{organizationUuid?:string|null, date?:Date|string|null, number?:string|null}} deletedDoc
 */
export async function resyncSequenceAfterDelete(docType, deletedDoc, client = prisma) {
	if (!NUMBER_CONFIG[docType] || !deletedDoc) return;
	// У документа не было номера — освобождать нечего.
	if (!String(deletedDoc.number ?? "").trim()) return;
	const settings = await loadSettings(client, deletedDoc.organizationUuid ?? null);
	const prefix = (settings[docType]?.prefix ?? "").trim();
	const year = (deletedDoc.date ? new Date(deletedDoc.date) : new Date()).getFullYear();
	const org = deletedDoc.organizationUuid || GLOBAL_SETTINGS_KEY;
	try {
		// Максимум среди ОСТАВШИХСЯ (удалённый документ уже физически удалён).
		const jmax = await journalMaxForYear(docType, deletedDoc.organizationUuid ?? null, year, prefix, client);
		// Счётчик = текущий максимум журнала → следующий allocate даст jmax+1.
		await client.$queryRawUnsafe(
			`INSERT INTO "document_sequences" ("organizationUuid","docType","year","lastValue")
			 VALUES ($1,$2,$3,$4)
			 ON CONFLICT ("organizationUuid","docType","year")
			 DO UPDATE SET "lastValue" = $4, "updatedAt" = now()`,
			org, sequenceKey(docType, prefix), year, jmax,
		);
	} catch (err) {
		console.error(`resyncSequenceAfterDelete(${docType}) error:`, err);
	}
}

/**
 * Приводит УЖЕ присвоенный номер к текущим настройкам (префикс), СОХРАНЯЯ
 * числовую часть (позицию в последовательности). Напр. после смены префикса:
 * «ПГРМ-3» → «3» (а НЕ следующий «4»). Используется кнопкой «Присвоить номер»
 * для существующего документа — чтобы переприсвоение не «перепрыгивало» вперёд
 * по сквозному счётчику.
 * @returns {Promise<string|null>} переформатированный номер или null (нет цифр/конфига).
 */
export async function reformatNumber(docType, organizationUuid, current, client = prisma) {
	const fmt = await getNumberFormat(docType, organizationUuid, client);
	if (!fmt) return null;
	const m = String(current ?? "").match(/(\d+)\s*$/);
	if (!m) return null;
	return formatDocNumber(fmt.prefix, parseInt(m[1], 10));
}

/**
 * Перенумеровывает ТОЛЬКО черновики (posted=false) выбранного вида документа под
 * ТЕКУЩИЕ настройки нумерации (префикс). Числовая часть номера сохраняется (та же
 * позиция в последовательности) — меняется лишь префикс и нормализуются нули:
 *   «000001» → «РЕАЛ-1» (после смены префикса).
 * Это гарантирует 1:1-соответствие и не создаёт коллизий; проведённые/
 * распечатанные документы НЕ затрагиваются.
 *
 * @param {string} docType
 * @param {string|null} organizationUuid  null/undefined → все организации (каждый
 *        документ приводится к своему действующему формату: орг-настройка
 *        или глобальная).
 * @returns {Promise<{updated:number, skipped:number}>}
 */
export async function renumberDraftDocuments(docType, organizationUuid, client = prisma) {
	const j = DOC_JOURNAL[docType];
	if (!j) return { updated: 0, skipped: 0 };
	const params = [];
	let where = `"deletedAt" IS NULL AND "posted" = false`;
	if (j.direction) where += ` AND "direction" = '${j.direction}'`;
	if (organizationUuid) { params.push(organizationUuid); where += ` AND "organizationUuid" = $${params.length}`; }
	let rows;
	try {
		rows = await client.$queryRawUnsafe(
			`SELECT "uuid","number","date","organizationUuid" FROM "${j.table}" WHERE ${where}`,
			...params,
		);
	} catch (err) {
		console.error(`renumberDraftDocuments(${docType}) select error:`, err);
		return { updated: 0, skipped: 0 };
	}
	let updated = 0, skipped = 0;
	const fmtCache = new Map(); // orgKey → {prefix,enabled}
	for (const r of rows) {
		const org = r.organizationUuid ?? null;
		const cacheKey = org || GLOBAL_SETTINGS_KEY;
		let fmt = fmtCache.get(cacheKey);
		if (fmt === undefined) { fmt = await getNumberFormat(docType, org, client); fmtCache.set(cacheKey, fmt); }
		if (!fmt) { skipped++; continue; }
		// Числовая часть = завершающая группа цифр («РЕАЛ-000123» → 123, «000123» → 123).
		const m = String(r.number ?? "").match(/(\d+)\s*$/);
		const newNumber = m
			? formatDocNumber(fmt.prefix, parseInt(m[1], 10))
			: await allocateNumber(docType, org, r.date, client); // номера не было — выдаём свежий
		if (!newNumber || newNumber === r.number) { skipped++; continue; }
		try {
			await client.$queryRawUnsafe(`UPDATE "${j.table}" SET "number" = $1 WHERE "uuid" = $2`, newNumber, r.uuid);
			updated++;
		} catch (err) {
			console.error(`renumberDraftDocuments(${docType}) update ${r.uuid} error:`, err);
			skipped++;
		}
	}
	return { updated, skipped };
}

/**
 * Текущий формат нумерации документа: префикс/включена. Префикс — из настроек
 * организации (с глобальным дефолтом). По умолчанию префикса нет.
 * @returns {Promise<{prefix:string, enabled:boolean}|null>}
 */
export async function getNumberFormat(docType, organizationUuid, client = prisma) {
	if (!NUMBER_CONFIG[docType]) return null;
	const settings = await loadSettings(client, organizationUuid);
	return {
		prefix: (settings[docType]?.prefix ?? "").trim(),
		enabled: settings[docType]?.enabled !== false,
	};
}

/**
 * Форматирует числовое значение для ХРАНЕНИЯ: «{ПРЕФИКС}-{N}» или «{N}» (без
 * префикса), БЕЗ ведущих нулей. Номера группируются по ПРЕФИКСУ — это отдельные
 * последовательности («ыва34234» с префиксом «ыва» и «34235» без — РАЗНЫЕ ряды).
 */
export function formatDocNumber(prefix, value) {
	const seq = String(Number(value) || 0);
	return prefix ? `${prefix}-${seq}` : seq;
}

/**
 * Нормализует номер для ХРАНЕНИЯ и СРАВНЕНИЯ: префикс остаётся инлайн, у числовой
 * части срезаются ведущие нули. «РЕАЛ-000042» → «РЕАЛ-42», «00074» → «74»,
 * «000» → «0». Строки без завершающих цифр возвращаются как есть (с триммингом).
 * Благодаря нормализации «74», «00074» и «000000074» считаются ОДНИМ номером.
 */
export function normalizeDocNumber(raw) {
	const s = String(raw ?? "").trim();
	if (!s) return "";
	const m = s.match(/^(.*?)(\d+)\s*$/);
	if (!m) return s;
	const digits = m[2].replace(/^0+/, "") || "0";
	return m[1] + digits;
}

/**
 * Длина нормализованной числовой части (для валидации лимита 9 символов).
 * «РЕАЛ-000042» → 2. Строки без цифр → 0.
 */
export function docNumberDigitLength(raw) {
	const m = String(raw ?? "").trim().match(/(\d+)\s*$/);
	if (!m) return 0;
	return (m[1].replace(/^0+/, "") || "0").length;
}

/**
 * Проставляет data.number, если он не задан явно (мутирует data). Вызывать в
 * create-эндпоинтах ПЕРЕД prisma.create.
 */
export async function ensureNumber(docType, data, client = prisma) {
	if (data.number != null && String(data.number).trim() !== "") return data.number;
	const n = await allocateNumber(docType, data.organizationUuid ?? null, data.date ?? null, client);
	if (n) data.number = n;
	return n;
}

export default { NUMBER_CONFIG, allocateNumber, ensureNumber };
