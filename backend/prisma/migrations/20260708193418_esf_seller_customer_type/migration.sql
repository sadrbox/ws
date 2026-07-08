-- ЭСФ: категория поставщика/получателя (роль в документе) — SellerType/CustomerType.
ALTER TABLE "outgoing_invoices" ADD COLUMN "esfSellerType" TEXT;
ALTER TABLE "outgoing_invoices" ADD COLUMN "esfCustomerType" TEXT;
