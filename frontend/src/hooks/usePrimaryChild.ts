import { useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "src/services/api/client";

interface ListResponse<T> {
	success: boolean;
	items: T[];
}

interface PrimaryItem {
	uuid?: string;
	isPrimary?: boolean;
	[k: string]: any;
}

/**
 * Управление "основным" дочерним объектом (BankAccount/Contract) у владельца.
 * Загружает список с фильтром по владельцу, ищет запись с isPrimary=true.
 * setPrimary(uuid) — PATCH/PUT записи с isPrimary=true (бэкенд сбрасывает остальные).
 * clearPrimary() — снимает флаг с текущей основной.
 */
export function usePrimaryChild(params: {
	endpoint: string;
	displayField?: string;
	scope: Record<string, string> | null;
	enabled?: boolean;
}) {
	const {
		endpoint,
		displayField = "name",
		scope,
		enabled = true,
	} = params;
	const queryClient = useQueryClient();
	const scopeKey = scope ? JSON.stringify(scope) : null;

	const query = useQuery<ListResponse<PrimaryItem>>({
		queryKey: ["primary-child", endpoint, scopeKey],
		queryFn: () =>
			api.get<ListResponse<PrimaryItem>>(`/${endpoint}`, {
				params: { ...(scope ?? {}), limit: 200 },
			}),
		enabled: Boolean(enabled && scope),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	});

	const primary = useMemo(() => {
		const items = query.data?.items ?? [];
		return items.find((i) => i.isPrimary === true) ?? null;
	}, [query.data]);

	const invalidate = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: ["primary-child", endpoint, scopeKey],
		});
		void queryClient.invalidateQueries({ queryKey: [endpoint] });
	}, [queryClient, endpoint, scopeKey]);

	const setPrimary = useCallback(
		async (uuid: string) => {
			if (!uuid) return;
			await api.put(`/${endpoint}/${uuid}`, { isPrimary: true });
			invalidate();
		},
		[endpoint, invalidate],
	);

	const clearPrimary = useCallback(async () => {
		if (!primary?.uuid) return;
		await api.put(`/${endpoint}/${primary.uuid}`, { isPrimary: false });
		invalidate();
	}, [endpoint, primary, invalidate]);

	const primaryUuid = primary?.uuid ?? "";
	const primaryName = primary ? String(primary[displayField] ?? "") : "";

	return {
		primaryUuid,
		primaryName,
		primary,
		isLoading: query.isLoading,
		setPrimary,
		clearPrimary,
	};
}

export default usePrimaryChild;
