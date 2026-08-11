// «Принятие к учёту ОС» — регламентный header-документ ввода основного средства
// в эксплуатацию. Собственных проводок НЕ формирует (posting не задан): флаг
// posted=«в эксплуатации» гейтит начисление амортизации, которое выполняет
// правило month_close (см. services/depreciation.js + accountingPosting.js).
import { createDocumentHeaderRouter } from "./_documentHeaderFactory.js";

export default createDocumentHeaderRouter({
	MODEL: "fixedAssetAcceptance",
	ROUTE: "fixed-asset-acceptances",
	numberDocType: "fixed_asset_acceptance",
	TEXT_FIELDS: ["number", "comment"],
	stringFields: ["organizationUuid", "fixedAssetUuid", "depreciationMethod", "depreciationAccount", "accumulatedAccount"],
	numberFields: ["initialCost", "liquidationValue", "usefulLifeMonths"],
	dateFields: ["depreciationStartDate"],
	include: {
		organization: true,
		fixedAsset: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	// Проводок нет: акт лишь фиксирует параметры и дату старта амортизации.
	defaultPosted: true,
});
