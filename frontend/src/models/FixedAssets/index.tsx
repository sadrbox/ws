// Справочник «Основные средства» (ОС). Карточки ОС для табличной части «Основные
// средства» в Поступлении и проводок по счёту 2410 (субконто FixedAsset). Единый
// паттерн справочника (createSimpleModel).
import { createSimpleModel } from "src/utils/createSimpleModel";
import { makePaneLabel , type LabelSource } from "src/utils/buildPaneLabel";
import columnsJson from "./columns.json";

const { Form: FixedAssetsForm, List: FixedAssetsList } = createSimpleModel({
	endpoint: "fixedassets",
	listName: "FixedAssetsList",
	storageKey: "fixed-assets-form",
	formLabel: "Основные средства",
	columnsJson,
	fields: [
		{ key: "name", label: "Наименование *", required: true, requiredMessage: "Наименование обязательно" },
		{ key: "inventoryNumber", label: "Инвентарный номер" },
		{ key: "note", label: "Примечание" },
	],
	buildPaneLabel: (saved: LabelSource) =>
		makePaneLabel("FixedAssetsList", "Основные средства", saved, (saved?.name as string | undefined) || undefined),
	getLabel: (d) => `${(d?.name as string | undefined) || "?"}`,
	defaultSort: { name: "asc" },
});

export { FixedAssetsList, FixedAssetsForm };
export default FixedAssetsList;
