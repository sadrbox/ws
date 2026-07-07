-- Интеграция с ИС ЭСФ РК: поля состояния ЭСФ на исходящем счёте-фактуре.
-- AlterTable
ALTER TABLE "outgoing_invoices" ADD COLUMN     "esfErrorText" TEXT,
ADD COLUMN     "esfInvoiceId" TEXT,
ADD COLUMN     "esfNum" TEXT,
ADD COLUMN     "esfRegistrationNumber" TEXT,
ADD COLUMN     "esfSentAt" TIMESTAMP(3),
ADD COLUMN     "esfStatus" TEXT,
ADD COLUMN     "esfXml" TEXT;

-- CreateIndex
CREATE INDEX "outgoing_invoices_esfStatus_idx" ON "outgoing_invoices"("esfStatus");
