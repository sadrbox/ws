import { createDocumentHeaderRouter } from "./_documentHeaderFactory.js";
import { reconcileReservationRegister, removeReservationRegister } from "../../services/reservationRegister.js";

export default createDocumentHeaderRouter({
	MODEL: "reservation",
	numberDocType: "reservation",
	ROUTE: "reservations",
	stringFields: ["organizationUuid", "counterpartyUuid", "contractUuid", "warehouseUuid"],
	include: {
		organization: true,
		counterparty: true,
		contract: true,
		warehouse: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	hasBasis: true,
	// Жёсткий резерв: пересобираем регистр резервов при изменении шапки
	// (дата/склад денормализованы в строки регистра) и удаляем при удалении.
	afterSave: (uuid) => reconcileReservationRegister(uuid),
	afterDelete: (doc) => removeReservationRegister(doc.uuid),
});
