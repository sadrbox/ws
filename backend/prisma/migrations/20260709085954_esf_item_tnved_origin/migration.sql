-- ЭСФ: пер-строчные ТН ВЭД и признак происхождения на позиции СФ исходящей.
ALTER TABLE "outgoing_invoice_items" ADD COLUMN "tnvedCode" TEXT;
ALTER TABLE "outgoing_invoice_items" ADD COLUMN "truOriginCode" TEXT;
