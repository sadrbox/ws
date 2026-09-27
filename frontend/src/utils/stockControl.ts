/**
 * Контроль остатков перед проведением расходного документа (UX-гард).
 *
 * Перед сохранением проведённого документа форма дёргает
 * POST /product-register/check-availability с ТЕКУЩИМИ (ещё не сохранёнными)
 * строками и складом. Если есть дефицит — сохранение прерывается до отправки
 * каких-либо мутаций. Источник истины — бэкенд-гард при проведении
 * (см. backend/services/productRegister.js).
 */
import { api } from "src/services/api/client";

/** Тип расходного документа-регистратора. */
export type ExpenseDocumentType = "sale" | "inventory_transfer" | "purchase_return" | "write_off";

export interface StockShortage {
	productUuid: string | null;
	productName: string;
	sku?: string;
	warehouseUuid: string | null;
	warehouseName: string;
	requested: number;
	available: number;
	deficit: number;
}

export interface CheckStockPayload {
	documentType: ExpenseDocumentType;
	/** uuid документа — исключается из остатка (повторное проведение/правка). */
	documentUuid?: string;
	/** Склад расхода (sale / purchase_return). */
	warehouseUuid?: string | null;
	/** Склад-источник расхода (inventory_transfer). */
	fromWarehouseUuid?: string | null;
	/** Организация документа — от неё зависит настройка «Контроль остатков ТМЗ». */
	organizationUuid?: string | null;
	/** Дата документа (настройки историчны). */
	date?: string | null;
	/**
	 * Основание документа. Реализация на основании резерва не должна упираться в собственный
	 * резерв (У8): сервер (check-availability) исключает резерв-основание из «зарезервировано».
	 */
	basisDocumentType?: string | null;
	basisDocumentUuid?: string | null;
	/** isService — строка-услуга, если вызывающий это знает: такие строки на остаток не проверяются. */
	items: Array<{ productUuid?: string | null; quantity?: number | string | null; isService?: boolean | null }>;
}

interface CheckStockResponse {
	success: boolean;
	ok: boolean;
	shortages: StockShortage[];
}

/**
 * УСЛУГИ СКЛАД НЕ ДВИГАЮТ — и на остаток не проверяются (аудит 26.09, У8).
 *
 * Предпроверка сервера (check-availability) считает остаток и по услугам, хотя гард
 * проведения их пропускает: реализацию со строкой «Доставка» при включённом (по умолчанию)
 * контроле было не провести — «нужно 1, доступно 0». Поэтому строки, про которые известно,
 * что это услуга, в запрос не идут, а дефициты сверяются с карточкой товара.
 */
export function withoutServiceShortages(
	shortages: StockShortage[],
	serviceUuids: ReadonlySet<string>,
): StockShortage[] {
	return shortages.filter((s) => !(s.productUuid && serviceUuids.has(s.productUuid)));
}

/** Какие из товаров — услуги (по карточке). Не удалось прочитать карточку — не услуга. */
async function loadServiceUuids(productUuids: string[]): Promise<Set<string>> {
	const unique = Array.from(new Set(productUuids.filter(Boolean)));
	const flags = await Promise.all(unique.map(async (uuid) => {
		try {
			const resp = await api.get<{ item?: { isService?: boolean | null } }>(`/products/${uuid}`);
			return resp?.item?.isService === true ? uuid : null;
		} catch {
			return null;
		}
	}));
	return new Set(flags.filter((u): u is string => !!u));
}

/**
 * Проверяет доступность остатка. Возвращает массив дефицитов (пустой — всё ок).
 * При сетевой ошибке возвращает пустой массив — бэкенд-гард при проведении
 * остаётся жёстким бэкстопом, поэтому ложно блокировать сохранение не нужно.
 */
export async function checkStockAvailability(
	payload: CheckStockPayload,
): Promise<StockShortage[]> {
	try {
		const items = payload.items
			.filter((it) => it.isService !== true)
			.map(({ productUuid, quantity }) => ({ productUuid, quantity }));
		if (!items.length) return [];
		const resp = await api.post<CheckStockResponse>(
			"/product-register/check-availability",
			{ ...payload, items },
		);
		const shortages = Array.isArray(resp?.shortages) ? resp.shortages : [];
		if (!shortages.length) return [];
		const services = await loadServiceUuids(shortages.map((s) => s.productUuid ?? ""));
		return withoutServiceShortages(shortages, services);
	} catch {
		return [];
	}
}

/** RU-сообщение со списком дефицитов: сгруппировано по складу, упорядочено по
 *  наименованию товара. Заголовок — первой строкой (без маркера), позиции — с «•». */
export function formatStockShortages(shortages: StockShortage[]): string {
	if (!shortages.length) return "";
	// Группировка по складу.
	const byWarehouse = new Map<string, StockShortage[]>();
	for (const s of shortages) {
		const wh = s.warehouseName || "";
		const arr = byWarehouse.get(wh);
		if (arr) arr.push(s); else byWarehouse.set(wh, [s]);
	}
	const multiWarehouse = byWarehouse.size > 1;
	const lines: string[] = [];
	for (const [wh, list] of byWarehouse) {
		list.sort((a, b) => (a.productName || "").localeCompare(b.productName || "", "ru"));
		if (multiWarehouse && wh) lines.push(`Склад «${wh}»:`);
		for (const s of list) {
			lines.push(`• ${s.productName || s.productUuid || "товар"} — нужно ${s.requested}, доступно ${s.available}, не хватает ${s.deficit}`);
		}
	}
	return `Недостаточно остатка для проведения:\n${lines.join("\n")}`;
}
