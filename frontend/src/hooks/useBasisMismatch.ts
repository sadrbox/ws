/**
 * useBasisMismatch — определяет, расходится ли зависимый документ с актуальным
 * документом-основанием (шапка + строки).
 *
 * Загружает текущее состояние основания через refillFromBasisSource
 * (utils/createFromBasis) с кэшированием react-query и сравнивает:
 *   - ключевые поля шапки (по умолчанию все *Uuid из mapFields основания);
 *   - строки таблицы по набору itemKeys.
 *
 * Сравнение — через isEquivalent (utils/normalize), устойчивое к "30" vs 30,
 * "" vs null и т.п. Активен только когда заданы basisType и basisUuid.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { refillFromBasisSource } from "src/utils/createFromBasis";
import { describeBasisDifferences } from "src/utils/basisDifferences";
import type { BasisSource } from "src/utils/createFromBasis";
import type { TDataItem } from "src/components/Table/types";

const DEFAULT_ITEM_KEYS = [
	"productUuid",
	"quantity",
	"price",
	"vatRate",
	"discountPercent",
	"exciseRate",
] as const;

export interface UseBasisMismatchArgs {
	basisType?: string | null;
	basisUuid?: string | null;
	/** Текущие поля формы зависимого документа. */
	currentFields: Record<string, unknown>;
	/** Текущие строки таблицы (включая pending; delete-маркеры отфильтровываются). */
	currentItems: TDataItem[];
	/** Маппинг шапки основания → поля зависимого документа (напр. mapCommonTradeFields). */
	mapFields: (src: BasisSource) => Record<string, unknown>;
	/** Метки полей для тултипа (ключ зависимого документа → подпись). */
	fieldLabels?: Record<string, string>;
	/** Поля строк для сравнения (по умолчанию товар/кол-во/цена/ставки). */
	itemKeys?: readonly string[];
	/** Режим сравнения строк:
	 *  - "exact" (по умолчанию): полное совпадение набора строк по itemKeys;
	 *  - "productsSubset": для ВОЗВРАТОВ — частичный возврат допустим, поэтому
	 *    кол-во/суммы НЕ сравниваем; расхождение — только если в зависимом документе
	 *    есть номенклатура, которой НЕТ в основании. */
	itemMatchMode?: "exact" | "productsSubset";
	/** Не сравнивать строки (для header-документов без табличной части, напр. банк-выписка). */
	ignoreItems?: boolean;
	/** Ключи шапки, которых НЕТ в дочернем документе (напр. у счёта-фактуры нет
	 *  warehouseUuid) — не считать расхождением, даже если они есть у основания. */
	ignoreFields?: readonly string[];
}

export interface BasisMismatchResult {
	mismatch: boolean;
	differences: string[];
}

export function useBasisMismatch({
	basisType,
	basisUuid,
	currentFields,
	currentItems,
	mapFields,
	fieldLabels,
	itemKeys = DEFAULT_ITEM_KEYS,
	itemMatchMode = "exact",
	ignoreItems = false,
	ignoreFields,
}: UseBasisMismatchArgs): BasisMismatchResult {
	const enabled = !!basisType && !!basisUuid;

	const { data } = useQuery({
		queryKey: ["basisSnapshot", basisType, basisUuid],
		queryFn: () => refillFromBasisSource(basisType!, basisUuid!, mapFields),
		enabled,
		staleTime: 30_000,
	});

	return useMemo<BasisMismatchResult>(() => {
		if (!enabled || !data) return { mismatch: false, differences: [] };

		// В чём именно расхождение — фразами со значениями (utils/basisDifferences).
		const differences = describeBasisDifferences({
			basisFields: data.fields ?? {},
			currentFields: currentFields ?? {},
			basisItems: ignoreItems ? [] : (data.items ?? []),
			currentItems: (currentItems ?? []).filter((r: TDataItem) => r._pendingAction !== "delete"),
			itemKeys, itemMatchMode, ignoreItems, ignoreFields, fieldLabels,
		});

		return { mismatch: differences.length > 0, differences };
	}, [enabled, data, currentFields, currentItems, fieldLabels, itemKeys, itemMatchMode, ignoreItems, ignoreFields]);
}

export default useBasisMismatch;
