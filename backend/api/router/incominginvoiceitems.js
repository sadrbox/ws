import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "incomingInvoiceItem",
	ROUTE: "incominginvoiceitems",
	PARENT_MODEL: "incomingInvoice",
	PARENT_FIELD: "incomingInvoiceUuid",
	hasTaxes: true,
});
