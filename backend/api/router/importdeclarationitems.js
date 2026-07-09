import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

// Позиции документа «ГТД по импорту». Без НДС (таможенная стоимость = qty × price).
// positionNumber — № товарной позиции в декларации (графа 32).
export default createDocumentItemsRouter({
	MODEL: "importDeclarationItem",
	ROUTE: "importdeclarationitems",
	PARENT_MODEL: "importDeclaration",
	PARENT_FIELD: "importDeclarationUuid",
	hasTaxes: false,
	extraStringFields: ["positionNumber"],
});
