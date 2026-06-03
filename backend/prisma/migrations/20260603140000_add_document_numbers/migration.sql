
-- AlterTable
ALTER TABLE "bank_statements" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "cash_expense_orders" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "cash_receipt_orders" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "commercial_offers" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "incoming_invoices" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "outgoing_invoices" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "payment_invoices" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "payroll_calculations" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "payroll_payments" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "purchase_requisitions" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "purchase_returns" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "sale_returns" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "number" TEXT;

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" SERIAL NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_organizationUuid_docType_year_key" ON "document_sequences"("organizationUuid", "docType", "year");

