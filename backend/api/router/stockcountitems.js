import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

// Позиции Инвентаризации. quantity — ФАКТ (вводит кладовщик),
// accountingQuantity — учётный остаток (снимок регистра, заполняется сервером).
// Движений/проводок документ не даёт, налогов нет.
export default createDocumentItemsRouter({
	MODEL: "stockCountItem",
	ROUTE: "stockcountitems",
	PARENT_MODEL: "stockCount",
	PARENT_FIELD: "stockCountUuid",
	hasTaxes: false,
	extraNumberFields: ["accountingQuantity"],
});
