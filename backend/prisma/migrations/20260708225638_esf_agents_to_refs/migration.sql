-- ЭСФ: поверенный → ссылка на контрагента/организацию (БИН/адрес резолвятся сервером).
ALTER TABLE "outgoing_invoices"
  DROP COLUMN IF EXISTS "esfCustomerAgentTin",
  DROP COLUMN IF EXISTS "esfCustomerAgentName",
  DROP COLUMN IF EXISTS "esfCustomerAgentAddress",
  DROP COLUMN IF EXISTS "esfSellerAgentTin",
  DROP COLUMN IF EXISTS "esfSellerAgentName",
  DROP COLUMN IF EXISTS "esfSellerAgentAddress",
  ADD COLUMN "esfCustomerAgentUuid" TEXT,
  ADD COLUMN "esfSellerAgentUuid" TEXT;
