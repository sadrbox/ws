-- ЭСФ: ГТД/декларация на товары на позиции СФ исходящей.
ALTER TABLE "outgoing_invoice_items" ADD COLUMN "productDeclaration" TEXT;
ALTER TABLE "outgoing_invoice_items" ADD COLUMN "productNumberInDeclaration" TEXT;
