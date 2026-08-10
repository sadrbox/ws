// Табличная часть «Основные средства» документа Поступление (Purchase).
// Строка: ОС (ссылка на справочник fixedassets) + Сумма + Ставка НДС + Сумма НДС
// («в том числе»). Редактирование inline; сохранение — через useFormStore.tables
// (deferRemoteChanges + onItemsChange → батч purchasefixedassetitems/batch).
import { FC, useCallback, useMemo } from "react";
import SubTable, { type SubTableContext } from "src/components/SubTable";
import LookupField from "src/components/Field/LookupField";
import { FieldNumber } from "src/components/Field";
import type { TColumn, TDataItem } from "src/components/Table/types";
import columnsJson from "./fixedAssetItemsColumns.json";

const ENDPOINT = "purchasefixedassetitems";
const COMPONENT = "PurchaseFixedAssetItemsList_part";

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n: unknown) => r2(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** НДС «в том числе» из суммы и ставки. */
const vatIncl = (amount: unknown, vatRate: unknown) => {
	const amt = r2(amount);
	const rate = Number(vatRate) || 0;
	return rate > 0 ? r2(amt - amt / (1 + rate / 100)) : 0;
};

interface Props {
	parentUuid: string;
	disabled?: boolean;
	deferRemoteChanges?: boolean;
	initialPendingRows?: TDataItem[];
	onItemsChange?: (items: TDataItem[]) => void;
}

const PurchaseFixedAssetsTable: FC<Props> = ({ parentUuid, disabled = false, deferRemoteChanges = false, initialPendingRows, onItemsChange }) => {
	const defaultNewRow = useMemo(() => ({ fixedAssetUuid: null, fixedAssetName: "", amount: 0, vatRate: 12 }), []);

	const renderCell = useCallback((row: TDataItem, col: TColumn, ctx: SubTableContext) => {
		if (col.identifier === "fixedAsset") {
			if (ctx.inlineEditing) return (
				<LookupField
					label="" name={`fa_${row.id}`}
					value={(row.fixedAssetUuid as string) ?? ""}
					displayValue={(row.fixedAssetName as string) ?? ""}
					endpoint="fixedassets"
					onSelect={(uuid, dv, item) => ctx.handleLookupChange(row, "fixedAssetUuid", uuid, { fixedAssetName: uuid ? ((item?.name as string) ?? dv) : null })}
					onClear={() => ctx.handleLookupChange(row, "fixedAssetUuid", null, { fixedAssetName: null })}
					disabled={ctx.disabled} width="100%" variant="table"
				/>
			);
			return <span>{(row.fixedAssetName as string) ?? ""}</span>;
		}
		if (col.identifier === "amount") {
			if (ctx.inlineEditing) return <FieldNumber label="" name={`fa_amt_${row.id}`} value={String(row.amount ?? "")} onChange={e => ctx.handleInlineChange(row, "amount", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" decimals={2} textAlign="right" />;
			return <span>{fmt(row.amount)}</span>;
		}
		if (col.identifier === "vatRate") {
			if (ctx.inlineEditing) return <FieldNumber label="" name={`fa_vr_${row.id}`} value={String(row.vatRate ?? 12)} onChange={e => ctx.handleInlineChange(row, "vatRate", e.target.value)} disabled={ctx.disabled} width="100%" variant="table" decimals={2} textAlign="right" />;
			return <span>{fmt(row.vatRate)}</span>;
		}
		if (col.identifier === "vatAmount") {
			return <span>{fmt(vatIncl(row.amount, row.vatRate))}</span>;
		}
		return undefined;
	}, []);

	return (
		<SubTable
			model={ENDPOINT}
			componentName={COMPONENT}
			columnsJson={columnsJson as TColumn[]}
			parentKey="purchaseUuid"
			parentUuid={parentUuid}
			defaultSort={{ id: "asc" }}
			disabled={disabled}
			deferRemoteChanges={deferRemoteChanges}
			initialPendingRows={initialPendingRows}
			onItemsChange={onItemsChange}
			renderCell={renderCell}
			defaultNewRow={defaultNewRow}
			disablePrimaryRowHighlight
		/>
	);
};

PurchaseFixedAssetsTable.displayName = "PurchaseFixedAssetsTable";
export default PurchaseFixedAssetsTable;
