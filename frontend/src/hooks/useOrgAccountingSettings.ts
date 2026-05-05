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
	/** UUID выбранной ставки НДС из справочника VatRate (валиден только при useVat). */
	vatRateUuid: string | null;
	/** Включает колонки скидок в SaleItemsTable (discountPercent, discountAmount). */
	useDiscount: boolean;
	updatedAt: string;
	deletedAt: string | null;
	organization?: {
		uuid: string;
		shortName: string | null;
	} | null;
	/** Развёрнутая ссылка на VatRate. */
	vatRateRef?: {
		uuid: string;
		shortName: string;
		rate: number | string | null;
		/** "INCLUDED" — НДС включён в цену; "ADDED" — начисляется сверху. */
		calculationMethod?: "INCLUDED" | "ADDED" | string | null;
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
 */
export function useOrgAccountingSettings(organizationUuid?: string | null) {
	const orgKey = organizationUuid || null;
	const query = useQuery<ActiveResponse>({
		queryKey: ["organization-accounting-settings", "active", orgKey],
		queryFn: () =>
			api.get<ActiveResponse>("/organization-accounting-settings/active", {
				params: orgKey ? { organizationUuid: orgKey } : {},
			}),
		staleTime: 60_000,
		gcTime: 5 * 60_000,
		refetchOnWindowFocus: false,
	});

	return useMemo(() => {
		const item = query.data?.item ?? null;
		const useVat = Boolean(item?.useVat);
		const vatRate = useVat ? item?.vatRateRef ?? null : null;
		const calcMethod = (vatRate?.calculationMethod ?? "INCLUDED")
			.toString()
			.toUpperCase();
		return {
			item,
			useVat,
			vatRate,
			vatRateUuid: useVat ? item?.vatRateUuid ?? null : null,
			useDiscount: Boolean(item?.useDiscount),
			isLoading: query.isLoading,
			/** НДС учитывается: useVat=true И задана ставка. */
			isVatEnabled: useVat && Boolean(item?.vatRateUuid),
			/** "INCLUDED" — НДС в сумме; "ADDED" — НДС сверху. */
			vatCalculationMethod: calcMethod === "ADDED" ? "ADDED" : "INCLUDED",
		};
	}, [query.data, query.isLoading]);
}

export default useOrgAccountingSettings;
