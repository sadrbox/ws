import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "src/services/api/client";

/**
 * Настройки учёта организации (журнальная модель).
 * 1 активная запись на организацию (deletedAt IS NULL).
 * Если organizationUuid=null — глобальные настройки (fallback).
 */
export interface OrgAccountingSettingItem {
	id: number;
	uuid: string;
	organizationUuid: string | null;
	/** Дата начала действия настроек (для исторических запросов). */
	startDate: string;
	/** Учитывать ли НДС в строках документов продажи. */
	useVat: boolean;
	/** Числовая Ставка НДС, % (ранее бралась из справочника VatRate, который удалён). */
	vatRate: number | string | null;
	/** Способ расчёта НДС: "INCLUDED" — в сумме; "ADDED" — сверху. */
	vatCalculationMethod: "INCLUDED" | "ADDED" | string;
	/** Включает колонки скидок в SaleItemsTable (discountPercent, discountAmount). */
	useDiscount: boolean;
	/** Включает колонки акциза в SaleItemsTable (exciseRate, exciseAmount). НК РК ст. 463. */
	useExcise: boolean;
	/** Ставка акциза по умолчанию, % (используется при добавлении новых строк). */
	exciseRate: number | string | null;
	updatedAt: string;
	deletedAt: string | null;
	organization?: {
		uuid: string;
		name: string | null;
	} | null;
}

interface ActiveResponse {
	success: boolean;
	item: OrgAccountingSettingItem | null;
}

/**
 * Хук возвращает активные настройки учёта для конкретной организации
 * (с fallback на глобальные при отсутствии). Кэшируется React Query.
 *
 * @param organizationUuid UUID организации; null/undefined → глобальные.
 * @param date  Опциональная дата документа (ISO-строка YYYY-MM-DD или Date).
 *   Если передана — настройки выбираются исторически: возвращается запись
 *   с максимальным startDate <= date. Это позволяет формам документа
 *   автоматически пересчитывать колонки НДС/скидок при изменении даты
 *   (даже для нового несохранённого документа). Без даты — поведение прежнее
 *   (текущие активные настройки).
 */
export function useOrgAccountingSettings(
	organizationUuid?: string | null,
	date?: string | Date | null,
) {
	const orgKey = organizationUuid || null;
	// Нормализуем дату в "YYYY-MM-DD" в ЛОКАЛЬНОЙ TZ (а не UTC), чтобы:
	//  • datetime-local значение из формы ("YYYY-MM-DDTHH:mm" без TZ)
	//    после конвертации сохранило тот же календарный день,
	//    который видит пользователь;
	//  • историческая выборка настроек НУО (startDate <= date) не сдвигалась
	//    в UTC при ранних утренних часах в KZ (+05/+06).
	const dateKey: string | null = (() => {
		if (!date) return null;
		const pad = (n: number) => String(n).padStart(2, "0");
		const formatLocal = (d: Date) =>
			`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		if (date instanceof Date) {
			if (isNaN(date.getTime())) return null;
			return formatLocal(date);
		}
		const s = String(date).trim();
		if (!s) return null;
		// Уже "YYYY-MM-DD" — оставляем как есть.
		if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
		// "YYYY-MM-DDTHH:mm" (datetime-local без TZ) — берём только дату.
		const m = /^(\d{4}-\d{2}-\d{2})T/.exec(s);
		if (m) return m[1];
		// Любой другой формат — парсим и берём ЛОКАЛЬНЫЕ компоненты.
		const d = new Date(s);
		if (isNaN(d.getTime())) return null;
		return formatLocal(d);
	})();

	const query = useQuery<ActiveResponse>({
		queryKey: ["organization-accounting-settings", "active", orgKey, dateKey],
		queryFn: () => {
			const params: Record<string, string> = {};
			if (orgKey) params.organizationUuid = orgKey;
			if (dateKey) params.date = dateKey;
			return api.get<ActiveResponse>(
				"/organization-accounting-settings/active",
				{ params },
			);
		},
		staleTime: 0,
		gcTime: 5 * 60_000,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
	});

	return useMemo(() => {
		const item = query.data?.item ?? null;
		const useVat = Boolean(item?.useVat);
		// НК РК ст. 422: Ставка НДС, % может быть от 0 до 100% (стандарт — 12%,
		// для ряда товаров — 0%). Используем точное значение из настроек.
		const vatRate = useVat ? Number(item?.vatRate ?? 0) || 0 : 0;
		const calcMethod = String(
			item?.vatCalculationMethod ?? "INCLUDED",
		).toUpperCase();
		return {
			item,
			useVat,
			/** Числовая Ставка НДС, %. 0 при отключённом useVat либо при
			 *  явно установленной ставке 0% (НК РК — экспорт, ряд категорий). */
			vatRate,
			useDiscount: Boolean(item?.useDiscount),
			useExcise: Boolean(item?.useExcise),
			/** Дефолтная Ставка акциза, % (число). 0 при отключённом useExcise. */
			exciseRate: item?.useExcise ? Number(item?.exciseRate ?? 0) || 0 : 0,
			isLoading: query.isLoading,
			/** НДС учитывается. Соответствует флагу useVat — колонки НДС
			 *  отображаются и при ставке 0% (валидно по НК РК). */
			isVatEnabled: useVat,
			/** "INCLUDED" — НДС в сумме; "ADDED" — НДС сверху. */
			vatCalculationMethod: (calcMethod === "ADDED" ? "ADDED" : "INCLUDED") as
				| "INCLUDED"
				| "ADDED",
		};
	}, [query.data, query.isLoading]);
}

export default useOrgAccountingSettings;
