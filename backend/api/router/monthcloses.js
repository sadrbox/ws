import { createDocumentHeaderRouter } from "./_documentHeaderFactory.js";
import { prisma } from "../../prisma/prisma-client.js";
import { invalidateClosedBoundary, getClosedBoundary } from "../../services/periodLock.js";
import { buildSnapshotsAt, deleteSnapshotsAfter } from "../../services/costSnapshot.js";

// Граница закрытого периода сдвинулась (закрытие проведено/распроведено/удалено) →
// пересобираем материализацию ФИФО-слоёв (product_cost_snapshot):
//   • снимаем снапшоты ПОЗЖЕ новой границы — они больше не на границе и протухли
//     (граница могла уехать назад при распроведении/удалении закрытия);
//   • строим снапшот НА самой границе — от него costing стартует вместо переигрывания
//     всей истории движений (см. services/costSnapshot.js).
// Снапшоты на БОЛЕЕ РАННИХ границах не трогаем: они остаются корректными, а
// getSnapshotFor всё равно берёт последний с asOfDate ≤ границы.
async function refreshCostSnapshots(orgUuid) {
	if (!orgUuid) return;
	try {
		const boundary = await getClosedBoundary(orgUuid);
		await deleteSnapshotsAfter(orgUuid, boundary); // boundary=null → снять все
		if (boundary) await buildSnapshotsAt(orgUuid, boundary);
	} catch (err) {
		// Снапшот — чистая ОПТИМИЗАЦИЯ: без него costing переигрывает историю целиком.
		// Поэтому его сбой не должен ронять сохранение документа.
		console.error("refreshCostSnapshots error:", err.message);
	}
}

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
	// Сброс идёт ПЕРВЫМ: refreshCostSnapshots читает границу и должен видеть свежую.
	afterSave: async (uuid) => {
		invalidateClosedBoundary();
		const doc = await prisma.monthClose.findUnique({
			where: { uuid },
			select: { organizationUuid: true },
		});
		await refreshCostSnapshots(doc?.organizationUuid ?? null);
	},
	afterDelete: async (doc) => {
		invalidateClosedBoundary();
		await refreshCostSnapshots(doc?.organizationUuid ?? null);
	},
});
