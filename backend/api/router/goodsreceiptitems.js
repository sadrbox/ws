import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

// Позиции документа «Оприходование товара». Без налогов: постановка излишков на
// учёт — не облагаемый оборот. Цена оприходования вводится пользователем
// (у излишка может не быть остатка, из которого выводится себестоимость).
export default createDocumentItemsRouter({
	MODEL: "goodsReceiptItem",
	ROUTE: "goodsreceiptitems",
	PARENT_MODEL: "goodsReceipt",
	PARENT_FIELD: "goodsReceiptUuid",
	hasTaxes: false,
	hasSourceRowId: true,
});
