// Перемещение ТМЗ — НК РК ст. 372 п.2 пп.3: внутренние перемещения
// не являются облагаемым оборотом, НДС/акциз/Сумма скидки не применяются.
import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "inventoryTransferItem",
	ROUTE: "inventorytransferitems",
	PARENT_MODEL: "inventoryTransfer",
	PARENT_FIELD: "inventoryTransferUuid",
	hasTaxes: false,
	extraStringFields: ["batchUuid"], // партия перемещаемого ТМЗ (T6.1 Stage 3)
});
