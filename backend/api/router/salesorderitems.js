import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "salesOrderItem",
	ROUTE: "sales-order-items",
	PARENT_MODEL: "salesOrder",
	PARENT_FIELD: "salesOrderUuid",
	hasTaxes: true,
});
