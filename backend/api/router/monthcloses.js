import { createDocumentHeaderRouter } from "./_documentHeaderFactory.js";
import { invalidateClosedBoundary } from "../../services/periodLock.js";

// «Закрытие месяца» — регламентный header-документ. Проводки (закрытие 6010/7010/
// 7210 → 5610 по чистым оборотам периода) формируются правилом POSTING_RULES.month_close.
// По умолчанию проводится (posted=true); период задаётся периодами periodStart/periodEnd.
export default createDocumentHeaderRouter({
	MODEL: "monthClose",
	ROUTE: "month-closes",
	numberDocType: "month_close",
	TEXT_FIELDS: ["number", "comment"],
	stringFields: ["organizationUuid"],
	numberFields: [],
	dateFields: ["periodStart", "periodEnd"],
	include: {
		organization: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	posting: { docType: "month_close" },
	defaultPosted: true,
	// Закрытие месяца само управляет границей запрета — оно НЕ блокируется.
	periodExempt: true,
	// Изменение закрытия меняет границу запрета — сбрасываем кэш границ немедленно
	// (иначе TTL-кэш до ~5 c мог бы пропустить правку в только что закрытом периоде).
	afterSave: () => invalidateClosedBoundary(),
	afterDelete: () => invalidateClosedBoundary(),
});
