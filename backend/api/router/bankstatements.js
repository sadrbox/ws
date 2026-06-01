import { createDocumentHeaderRouter } from "./_documentHeaderFactory.js";

export default createDocumentHeaderRouter({
	MODEL: "bankStatement",
	ROUTE: "bank-statements",
	stringFields: ["organizationUuid", "counterpartyUuid", "contractUuid", "bankAccountUuid", "direction"],
	include: {
		organization: true,
		counterparty: true,
		contract: true,
		bankAccount: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	hasBasis: true,
	posting: { docType: "bank_statement" },
	defaultPosted: true,
});
