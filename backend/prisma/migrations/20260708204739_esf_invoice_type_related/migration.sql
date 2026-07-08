-- ЭСФ: тип документа (обычный/исправленный/дополнительный) + связь с основным ЭСФ.
ALTER TABLE "outgoing_invoices" ADD COLUMN "esfInvoiceType" TEXT;
ALTER TABLE "outgoing_invoices" ADD COLUMN "esfRelatedInvoiceUuid" TEXT;
