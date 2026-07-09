import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "src/services/api/client";
import { getFormatDateOnly } from "src/utils/datetime";

export interface ExistingDependent {
	uuid: string;
	id: number;
	number?: string | null;
	date: string;
}

export const EXISTING_DEPENDENT_KEY = "existingDependent";

async function fetchDependent(
	sourceUuid: string,
	ep: string,
): Promise<ExistingDependent | null> {
	const filter = { basisDocumentUuid: { equals: sourceUuid } };
	const resp: any = await api.get(`/${ep}`, { params: { filter, limit: 1 } });
	const items: any[] = Array.isArray(resp)
		? resp
		: (resp?.items ?? resp?.data ?? []);
	if (!items[0]) return null;
	return { uuid: items[0].uuid, id: items[0].id, number: items[0].number ?? null, date: items[0].date };
}

/**
 * Для каждого endpoint проверяет, существует ли зависимый документ
 * с basisDocumentUuid === sourceUuid. Результат: карта endpoint → документ | null.
 * null означает «не найден», undefined — «ещё загружается».
 */
export function useExistingDependents(
	sourceUuid: string | undefined,
	endpoints: string[],
): Record<string, ExistingDependent | null | undefined> {
	const results = useQueries({
		queries: endpoints.map((ep) => ({
			queryKey: [EXISTING_DEPENDENT_KEY, sourceUuid, ep],
			queryFn: () => fetchDependent(sourceUuid!, ep),
			enabled: !!sourceUuid,
			staleTime: 60_000,
		})),
	});

	return useMemo(
		() => Object.fromEntries(endpoints.map((ep, i) => [ep, results[i].data])),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[endpoints.join(","), results],
	);
}

/** Форматирует метку опции "На основании": ссылка на существующий документ или "Создать ...". */
export function formatDependentOption(
	docLabel: string,
	dep: ExistingDependent | null | undefined,
): string {
	if (dep) {
		const dateStr = dep.date ? ` - ${getFormatDateOnly(dep.date) ?? ""}` : "";
		const ref = dep.number ? `№ ${dep.number}` : `ID ${dep.id}`;
		return `${docLabel}: ${ref}${dateStr}`;
	}
	return `Создать ${docLabel}`;
}
