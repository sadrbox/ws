import { useQuery } from "@tanstack/react-query";
import { api } from "src/services/api/client";

/**
 * Признаки фактического использования НДС/скидок/акциза в проведённых
 * документах продажи. Используется в форме «Настройки учёта организации»
 * для блокировки переключателей: если для организации существует хотя бы
 * один проведённый sale_item с фактически применённым флагом, отключать
 * соответствующую опцию нельзя — это нарушит исторические расчёты ЭСФ РК.
 */
export interface OrgAccountingUsageStats {
	hasPostedVat: boolean;
	hasPostedDiscount: boolean;
	hasPostedExcise: boolean;
}

interface UsageStatsResponse extends OrgAccountingUsageStats {
	success: boolean;
}

const EMPTY: OrgAccountingUsageStats = {
	hasPostedVat: false,
	hasPostedDiscount: false,
	hasPostedExcise: false,
};

/**
 * Загружает статистику использования настроек НУО проведёнными документами.
 *
 * @param organizationUuid UUID организации; null/undefined → глобально (все).
 * @param enabled управляет ли запрос автоматически (по умолчанию true).
 */
export function useOrgAccountingUsageStats(
	organizationUuid?: string | null,
	enabled: boolean = true,
) {
	const orgKey = organizationUuid || null;

	const query = useQuery<UsageStatsResponse>({
		queryKey: ["organization-accounting-settings", "usage-stats", orgKey],
		queryFn: () => {
			const params: Record<string, string> = {};
			if (orgKey) params.organizationUuid = orgKey;
			return api.get<UsageStatsResponse>(
				"/organization-accounting-settings/usage-stats",
				{ params },
			);
		},
		// staleTime=0 + refetchOnMount: проведение/распроведение документов
		// должно мгновенно отражаться на блокировках в форме НУО.
		staleTime: 0,
		gcTime: 5 * 60_000,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
		enabled,
	});

	return {
		stats: (query.data ?? EMPTY),
		isLoading: query.isLoading,
	};
}

export default useOrgAccountingUsageStats;
