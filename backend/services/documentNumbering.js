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
};

// Кэш переопределений префиксов (короткий TTL — настройки меняются редко).
let _settingsCache = null;
let _settingsCacheAt = 0;
const SETTINGS_TTL = 15_000;

async function loadSettings(client) {
	const now = Date.now();
	if (_settingsCache && now - _settingsCacheAt < SETTINGS_TTL) return _settingsCache;
	const map = {};
	try {
		const rows = await client.documentNumberSetting.findMany();
		for (const r of rows) map[r.docType] = { prefix: r.prefix, padding: r.padding };
	} catch {
		/* нет таблицы/ошибка — используем дефолты */
	}
	_settingsCache = map;
	_settingsCacheAt = now;
	return map;
}

/** Сбросить кэш настроек (вызывать после изменения настроек нумерации). */
export function invalidateNumberSettingsCache() {
	_settingsCache = null;
	_settingsCacheAt = 0;
}

/**
 * Выделяет следующий номер документа (атомарно увеличивает счётчик).
 * @returns {Promise<string|null>} номер «ПРЕФИКС-000123» или null (нет конфига).
 */
export async function allocateNumber(docType, organizationUuid, date, client = prisma) {
	const def = NUMBER_CONFIG[docType];
	if (!def) return null;
	const settings = await loadSettings(client);
	const prefix = settings[docType]?.prefix || def.prefix;
	const padding = settings[docType]?.padding || 6;
	const year = (date ? new Date(date) : new Date()).getFullYear();
	const org = organizationUuid || "__global__";
	try {
		const row = await client.documentSequence.upsert({
			where: { organizationUuid_docType_year: { organizationUuid: org, docType, year } },
			create: { organizationUuid: org, docType, year, lastValue: 1 },
			update: { lastValue: { increment: 1 } },
		});
		return `${prefix}-${String(row.lastValue).padStart(padding, "0")}`;
	} catch (err) {
		console.error(`allocateNumber(${docType}) error:`, err);
		return null;
	}
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
