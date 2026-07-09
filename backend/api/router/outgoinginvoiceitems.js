import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "outgoingInvoiceItem",
	ROUTE: "outgoinginvoiceitems",
	PARENT_MODEL: "outgoingInvoice",
	PARENT_FIELD: "outgoingInvoiceUuid",
	hasTaxes: true,
	hasSourceRowId: true,
	esfLineFields: true,
});
