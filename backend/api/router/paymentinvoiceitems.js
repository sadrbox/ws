import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "paymentInvoiceItem",
	ROUTE: "paymentinvoiceitems",
	PARENT_MODEL: "paymentInvoice",
	PARENT_FIELD: "paymentInvoiceUuid",
	hasTaxes: true,
});
