import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "purchaseRequisitionItem",
	ROUTE: "purchase-requisition-items",
	PARENT_MODEL: "purchaseRequisition",
	PARENT_FIELD: "purchaseRequisitionUuid",
	hasTaxes: true,
	hasSourceRowId: true,
});
