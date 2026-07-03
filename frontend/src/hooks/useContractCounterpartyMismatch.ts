import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "src/services/api/client";

/**
 * Проактивная детекция несоответствия «договор ↔ контрагент».
 *
 * Возвращает true, если у ВЫБРАННОГО договора указан контрагент, ОТЛИЧНЫЙ от
 * выбранного в документе. Договор без контрагента (общий) несоответствием не
 * считается. Активно только когда заданы и договор, и контрагент.
 *
 * Договор дозагружается через react-query (кэш), т.к. в полях формы хранится
 * только contractUuid — собственный контрагент договора неизвестен без запроса.
 * Бэкенд дублирует проверку при сохранении (assertOrgFieldMembership).
 */
export function useContractCounterpartyMismatch(
	contractUuid: string | undefined | null,
	counterpartyUuid: string | undefined | null,
): boolean {
	const enabled = !!contractUuid && !!counterpartyUuid;

	const { data } = useQuery({
		queryKey: ["contract-counterparty", contractUuid],
		queryFn: () => api.get<{ item?: { counterpartyUuid?: string | null } }>(`contracts/${contractUuid}`),
		enabled,
		staleTime: 5 * 60 * 1000,
	});

	return useMemo(() => {
		if (!enabled) return false;
		const contractCpty = data?.item?.counterpartyUuid ?? null;
		return !!contractCpty && contractCpty !== counterpartyUuid;
	}, [enabled, data, counterpartyUuid]);
}

export default useContractCounterpartyMismatch;
