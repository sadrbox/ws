import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "src/services/api/client";

// ═══════════════════════════════════════════════════════════════════════════
// Синхронизация договора при СМЕНЕ КОНТРАГЕНТА в форме документа.
//
// Правила (единые для всех документов):
//   1) у нового контрагента есть ОСНОВНОЙ договор (isPrimary) → подставляем его;
//   2) основного нет, а текущий договор принадлежит ДРУГОМУ контрагенту → чистим
//      поле (иначе в документе остался бы чужой договор);
//   3) договор БЕЗ контрагента («общий») несоответствием не считается — не трогаем
//      (та же семантика, что у useContractCounterpartyMismatch);
//   4) контрагент очищен → чистим договор, если он был чьим-то (п.2).
//
// Отличие от useAutoFillPrimary: тот подставляет основной ТОЛЬКО на новой форме и
// ТОЛЬКО в пустое поле (не перетирает ручной выбор). Здесь — реакция именно на смену
// контрагента, поэтому работает и в режиме редактирования, и поверх заполненного поля.
//
// Бэкенд гарантирует, что isPrimary=true максимум у одного договора контрагента
// (router/contracts.js), и дублирует проверку соответствия при сохранении
// (assertOrgFieldMembership).
// ═══════════════════════════════════════════════════════════════════════════

interface ContractListItem {
	uuid?: string;
	name?: string;
	isPrimary?: boolean;
}

/** Патч полей формы: подставить договор либо очистить (пустые строки). */
export interface ContractPatch {
	contractUuid: string;
	contractName: string;
}

/**
 * ЧИСТОЕ правило (без запросов) — что сделать с договором при новом контрагенте.
 * Вынесено из хука, чтобы поведение можно было закрепить тестами.
 *
 * @returns патч полей, либо null — «оставить договор как есть».
 */
export function decideContract(args: {
	/** Новый контрагент ("" — очищен). */
	counterpartyUuid: string;
	/** Основной (isPrimary) договор нового контрагента, если есть. */
	primaryUuid?: string | null;
	primaryName?: string | null;
	/** Договор, стоящий в форме сейчас. */
	currentContractUuid: string;
	/** Контрагент ТЕКУЩЕГО договора (null — «общий» договор, без контрагента). */
	currentContractOwner: string | null;
}): ContractPatch | null {
	const { counterpartyUuid, primaryUuid, primaryName, currentContractUuid, currentContractOwner } = args;

	// 1) У контрагента есть основной договор → подставляем (перетирая прежний).
	if (counterpartyUuid && primaryUuid) {
		return { contractUuid: primaryUuid, contractName: primaryName ?? "" };
	}
	// Договора в форме нет — чистить нечего.
	if (!currentContractUuid) return null;
	// 2) Текущий договор принадлежит ДРУГОМУ контрагенту → чистим.
	//    (при очищенном контрагенте counterpartyUuid==="" — любой «чей-то» договор чужой)
	if (currentContractOwner && currentContractOwner !== counterpartyUuid) {
		return { contractUuid: "", contractName: "" };
	}
	// 3) «Общий» договор (без контрагента) валиден для любого — оставляем.
	return null;
}

export function useContractSync() {
	const queryClient = useQueryClient();

	return useCallback(
		async (opts: {
			/** Выбранный контрагент ("" — очищен). */
			counterpartyUuid: string;
			/** Организация документа (сужает выборку договоров). */
			organizationUuid?: string | null;
			/** Договор, который сейчас стоит в форме. */
			currentContractUuid: string;
		}): Promise<ContractPatch | null> => {
			const { counterpartyUuid, organizationUuid, currentContractUuid } = opts;

			try {
				// Основной договор нового контрагента (если контрагент задан).
				let primary: ContractListItem | undefined;
				if (counterpartyUuid) {
					const params: Record<string, string> = { counterpartyUuid, limit: "200" };
					if (organizationUuid) params.organizationUuid = organizationUuid;
					const list = await queryClient.fetchQuery({
						queryKey: ["contracts-for-counterparty", counterpartyUuid, organizationUuid ?? ""],
						queryFn: () => api.get<{ items?: ContractListItem[] }>("contracts", { params }),
						staleTime: 30_000,
					});
					primary = (list?.items ?? []).find((c) => c.isPrimary === true);
					// Основной найден — текущий договор дозагружать не нужно (он будет перетёрт).
					if (primary?.uuid) {
						return decideContract({
							counterpartyUuid,
							primaryUuid: primary.uuid,
							primaryName: primary.name,
							currentContractUuid,
							currentContractOwner: null,
						});
					}
				}

				// Основного нет (или контрагент очищен) → нужен владелец текущего договора.
				if (!currentContractUuid) return null;
				const cur = await queryClient.fetchQuery({
					// Ключ совпадает с useContractCounterpartyMismatch — переиспользуем кэш.
					queryKey: ["contract-counterparty", currentContractUuid],
					queryFn: () =>
						api.get<{ item?: { counterpartyUuid?: string | null } }>(`contracts/${currentContractUuid}`),
					staleTime: 5 * 60 * 1000,
				});
				return decideContract({
					counterpartyUuid,
					primaryUuid: null,
					currentContractUuid,
					currentContractOwner: cur?.item?.counterpartyUuid ?? null,
				});
			} catch {
				// Справочник недоступен — не мешаем работе с формой: договор оставляем как есть.
				return null;
			}
		},
		[queryClient],
	);
}

export default useContractSync;
