import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "purchaseItem",
	ROUTE: "purchaseitems",
	PARENT_MODEL: "purchase",
	PARENT_FIELD: "purchaseUuid",
	hasTaxes: true,
	hasSourceRowId: true,
	extraStringFields: ["batchUuid"],
});
