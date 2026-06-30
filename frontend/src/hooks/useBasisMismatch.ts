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
import { translate } from "src/i18";
import { refillFromBasisSource } from "src/utils/createFromBasis";
import { isEquivalent } from "src/utils/normalize";

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
	currentFields: Record<string, any>;
	/** Текущие строки таблицы (включая pending; delete-маркеры отфильтровываются). */
	currentItems: any[];
	/** Маппинг шапки основания → поля зависимого документа (напр. mapCommonTradeFields). */
	mapFields: (src: any) => Record<string, any>;
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

/** Подпись поля шапки: явная метка → перевод базового имени → само имя ключа. */
function fieldLabel(key: string, fieldLabels?: Record<string, string>): string {
	if (fieldLabels?.[key]) return fieldLabels[key];
	const base = key.replace(/Uuid$/, "");
	const translated = translate(base);
	return translated && translated !== base ? translated : base;
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

		const differences: string[] = [];

		// ── Шапка: сверяем идентификаторы (*Uuid) основания с зависимым документом.
		const basisFields = data.fields ?? {};
		for (const key of Object.keys(basisFields)) {
			if (!key.endsWith("Uuid")) continue; // только идентификаторы, без имён/дат
			if (key.startsWith("basisDocument")) continue;
			// Сравниваем только поля, которые реально есть у зависимого документа
			// (напр. у счёта-фактуры нет warehouseUuid — не считаем расхождением).
			if (!(key in (currentFields ?? {}))) continue;
			if (ignoreFields?.includes(key)) continue;
			if (!isEquivalent(basisFields[key], currentFields?.[key])) {
				differences.push(fieldLabel(key, fieldLabels));
			}
		}

		// ── Строки: число и совпадение по ключевым полям, БЕЗ учёта порядка.
		// Для header-документов без табличной части (банк-выписка) сравнение
		// строк пропускается — иначе расхождение было бы всегда.
		const basisItems = ignoreItems ? [] : (data.items ?? []);
		const cur = (currentItems ?? []).filter(
			(r: any) => r._pendingAction !== "delete",
		);

		// ВОЗВРАТЫ: частичный возврат допустим → не сверяем кол-во/суммы, а только
		// что каждая номенклатура зависимого документа присутствует в основании.
		if (!ignoreItems && itemMatchMode === "productsSubset") {
			const basisProducts = new Set(
				basisItems.map((r: any) => r?.productUuid).filter(Boolean),
			);
			const hasExtraneous = cur.some(
				(r: any) => r?.productUuid && !basisProducts.has(r.productUuid),
			);
			if (hasExtraneous) {
				differences.push(
					translate("basisMismatchExtraProduct") || "номенклатура отсутствует в основании",
				);
			}
			return { mismatch: differences.length > 0, differences };
		}

		const serializeRow = (r: any) =>
			itemKeys
				.map((k) => {
					const v = r?.[k];
					// Нормализуем "30" vs 30 vs null → единая строка (как isEquivalent).
					if (v === null || v === undefined || v === "") return "";
					const n = Number(v);
					return Number.isFinite(n) && String(v).trim() !== "" ? String(n) : String(v);
				})
				.join("|");
		const sortedSig = (rows: any[]) => rows.map(serializeRow).sort();
		const curSig = sortedSig(cur);
		const basisSig = sortedSig(basisItems);
		const itemsSame =
			curSig.length === basisSig.length &&
			curSig.every((s, i) => s === basisSig[i]);
		if (!itemsSame) {
			differences.push(
				translate("basisMismatchItems") || "строки отличаются от основания",
			);
		}

		return { mismatch: differences.length > 0, differences };
	}, [enabled, data, currentFields, currentItems, fieldLabels, itemKeys, itemMatchMode, ignoreItems, ignoreFields]);
}

export default useBasisMismatch;
