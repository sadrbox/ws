import { createDocumentHeaderRouter } from "./_documentHeaderFactory.js";

export default createDocumentHeaderRouter({
	MODEL: "purchaseOrder",
	ROUTE: "purchase-orders",
	stringFields: ["organizationUuid", "counterpartyUuid", "contractUuid", "warehouseUuid"],
	include: {
		organization: true,
		counterparty: true,
		contract: true,
		warehouse: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	hasBasis: true,
});
