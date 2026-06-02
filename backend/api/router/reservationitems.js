import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

export default createDocumentItemsRouter({
	MODEL: "reservationItem",
	ROUTE: "reservation-items",
	PARENT_MODEL: "reservation",
	PARENT_FIELD: "reservationUuid",
	hasTaxes: true,
	hasSourceRowId: true,
});
