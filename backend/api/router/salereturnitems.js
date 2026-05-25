import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "saleReturnItem",
	ROUTE: "sale-return-items",
	PARENT_MODEL: "saleReturn",
	PARENT_FIELD: "saleReturnUuid",
	hasTaxes: true,
});
