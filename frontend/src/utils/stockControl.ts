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
export type ExpenseDocumentType = "sale" | "inventory_transfer" | "purchase_return";

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
	items: Array<{ productUuid?: string | null; quantity?: number | string | null }>;
}

interface CheckStockResponse {
	success: boolean;
	ok: boolean;
	shortages: StockShortage[];
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
		const resp = await api.post<CheckStockResponse>(
			"/product-register/check-availability",
			payload,
		);
		return Array.isArray(resp?.shortages) ? resp.shortages : [];
	} catch {
		return [];
	}
}

/** RU-сообщение со списком дефицитов для показа пользователю. */
export function formatStockShortages(shortages: StockShortage[]): string {
	if (!shortages.length) return "";
	const lines = shortages.map(
		(s) =>
			`• ${s.productName || s.productUuid || "товар"}` +
			`${s.warehouseName ? ` (${s.warehouseName})` : ""}: ` +
			`нужно ${s.requested}, доступно ${s.available} (не хватает ${s.deficit})`,
	);
	return `Недостаточно остатка для проведения:\n${lines.join("\n")}`;
}
