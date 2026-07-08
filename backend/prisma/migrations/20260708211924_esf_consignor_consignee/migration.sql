-- ЭСФ: грузоотправитель/грузополучатель (раздел D) — ссылки на контрагентов.
ALTER TABLE "outgoing_invoices" ADD COLUMN "esfConsignorUuid" TEXT;
ALTER TABLE "outgoing_invoices" ADD COLUMN "esfConsigneeUuid" TEXT;
