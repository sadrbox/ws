// Документ «Установка цен номенклатуры» (шапка). Строки — в
// productpricesettingitems.js. На проведении/правке/удалении пересчитываются
// текущие цены товаров (services/productPricing.js).
import { createDocumentHeaderRouter } from "./_documentHeaderFactory.js";
import { reconcilePricesForDoc } from "../../services/productPricing.js";

export default createDocumentHeaderRouter({
	MODEL: "productPriceSetting",
	ROUTE: "product-price-settings",
	TEXT_FIELDS: ["comment", "number"],
	stringFields: ["comment", "organizationUuid"],
	numberFields: [],
	numberDocType: "price_setting",
	include: {
		organization: true,
		author: { select: { uuid: true, username: true, email: true } },
	},
	afterSave: async (uuid) => { await reconcilePricesForDoc(uuid); },
	afterDelete: async (doc) => { await reconcilePricesForDoc(doc.uuid); },
});
