import { createDocumentItemsRouter } from "./_documentItemsFactory.js";

// Позиции документа «Списание товара». Без налогов: списание — не облагаемый
// оборот. Цена в строке НЕ вводится: себестоимость определяется учётом
// (ФИФО/средняя) при проведении — см. productRegister/accountingPosting.
// sourceRowId — для идемпотентного «Перезаполнить по основанию» (Инвентаризация).
export default createDocumentItemsRouter({
	MODEL: "writeOffItem",
	ROUTE: "writeoffitems",
	PARENT_MODEL: "writeOff",
	PARENT_FIELD: "writeOffUuid",
	hasTaxes: false,
	hasSourceRowId: true,
});
