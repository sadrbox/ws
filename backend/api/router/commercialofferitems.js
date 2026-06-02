import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "commercialOfferItem",
	ROUTE: "commercial-offer-items",
	PARENT_MODEL: "commercialOffer",
	PARENT_FIELD: "commercialOfferUuid",
	hasTaxes: true,
	hasSourceRowId: true,
});
