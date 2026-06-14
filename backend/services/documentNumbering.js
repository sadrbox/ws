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
 * Карта docType → {prefix, padding} для организации: глобальные значения
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
		for (const r of rows) if (r.organizationUuid === GLOBAL_SETTINGS_KEY) map[r.docType] = { prefix: r.prefix, padding: r.padding, enabled: r.enabled };
		if (orgKey !== GLOBAL_SETTINGS_KEY)
			for (const r of rows) if (r.organizationUuid === orgKey) map[r.docType] = { prefix: r.prefix, padding: r.padding, enabled: r.enabled };
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
 * Выделяет следующий номер документа (атомарно увеличивает счётчик).
 * @returns {Promise<string|null>} номер «ПРЕФИКС-000123» или null (нет конфига).
 */
export async function allocateNumber(docType, organizationUuid, date, client = prisma) {
	const def = NUMBER_CONFIG[docType];
	if (!def) return null;
	const settings = await loadSettings(client, organizationUuid);
	// Автонумерация выключена для этого вида документа → номер не присваиваем.
	if (settings[docType]?.enabled === false) return null;
	// Префикс опционален: по умолчанию его нет, номер — только дополненный нулями
	// счётчик («000000001»). Префикс добавляется через «-», только если задан.
	const prefix = (settings[docType]?.prefix ?? "").trim();
	const padding = settings[docType]?.padding || 6;
	const year = (date ? new Date(date) : new Date()).getFullYear();
	const org = organizationUuid || "__global__";
	try {
		const row = await client.documentSequence.upsert({
			where: { organizationUuid_docType_year: { organizationUuid: org, docType, year } },
			create: { organizationUuid: org, docType, year, lastValue: 1 },
			update: { lastValue: { increment: 1 } },
		});
		const seq = String(row.lastValue).padStart(padding, "0");
		return prefix ? `${prefix}-${seq}` : seq;
	} catch (err) {
		console.error(`allocateNumber(${docType}) error:`, err);
		return null;
	}
}

/**
 * Текущий формат нумерации документа: префикс/ширина/включена. Префикс и ширина —
 * из настроек организации (с глобальным дефолтом). По умолчанию префикса нет.
 * @returns {Promise<{prefix:string, padding:number, enabled:boolean}|null>}
 */
export async function getNumberFormat(docType, organizationUuid, client = prisma) {
	if (!NUMBER_CONFIG[docType]) return null;
	const settings = await loadSettings(client, organizationUuid);
	return {
		prefix: (settings[docType]?.prefix ?? "").trim(),
		padding: settings[docType]?.padding || 6,
		enabled: settings[docType]?.enabled !== false,
	};
}

/**
 * Форматирует числовое значение номера: «{ПРЕФИКС}-{NNNN}» или «{NNNN}» (без
 * префикса), с дополнением нулями до padding. Best practice: номера группируются
 * по ПРЕФИКСУ — это отдельные последовательности («ыва34234» с префиксом «ыва» и
 * «000034235» без префикса — РАЗНЫЕ ряды).
 */
export function formatDocNumber(prefix, padding, value) {
	const seq = String(Number(value) || 0).padStart(padding, "0");
	return prefix ? `${prefix}-${seq}` : seq;
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
