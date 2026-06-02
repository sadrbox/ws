import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "purchaseOrderItem",
	ROUTE: "purchase-order-items",
	PARENT_MODEL: "purchaseOrder",
	PARENT_FIELD: "purchaseOrderUuid",
	hasTaxes: true,
	hasSourceRowId: true,
});
