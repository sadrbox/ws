import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "purchaseReturnItem",
	ROUTE: "purchase-return-items",
	PARENT_MODEL: "purchaseReturn",
	PARENT_FIELD: "purchaseReturnUuid",
	hasTaxes: true,
});
