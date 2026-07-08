-- ЭСФ Э5: поверенный/оператор (I/J) и госучреждение (C1, госзакуп).
ALTER TABLE "outgoing_invoices"
  ADD COLUMN "esfCustomerAgentTin" TEXT,
  ADD COLUMN "esfCustomerAgentName" TEXT,
  ADD COLUMN "esfCustomerAgentAddress" TEXT,
  ADD COLUMN "esfCustomerAgentDocNum" TEXT,
  ADD COLUMN "esfCustomerAgentDocDate" TEXT,
  ADD COLUMN "esfSellerAgentTin" TEXT,
  ADD COLUMN "esfSellerAgentName" TEXT,
  ADD COLUMN "esfSellerAgentAddress" TEXT,
  ADD COLUMN "esfSellerAgentDocNum" TEXT,
  ADD COLUMN "esfSellerAgentDocDate" TEXT,
  ADD COLUMN "esfPoBik" TEXT,
  ADD COLUMN "esfPoIik" TEXT,
  ADD COLUMN "esfPoPayPurpose" TEXT,
  ADD COLUMN "esfPoProductCode" TEXT;
