/*
  Warnings:

  - You are about to drop the column `documentDate` on the `cash_expense_orders` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `cash_receipt_orders` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `incoming_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `inventory_transfers` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `outgoing_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `payment_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `payroll_calculations` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `payroll_payments` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `purchases` table. All the data in the column will be lost.
  - You are about to drop the column `documentDate` on the `sales` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "cash_expense_orders_documentDate_idx";

-- DropIndex
DROP INDEX "cash_receipt_orders_documentDate_idx";

-- DropIndex
DROP INDEX "incoming_invoices_documentDate_idx";

-- DropIndex
DROP INDEX "inventory_transfers_documentDate_idx";

-- DropIndex
DROP INDEX "outgoing_invoices_documentDate_idx";

-- DropIndex
DROP INDEX "payment_invoices_documentDate_idx";

-- DropIndex
DROP INDEX "payroll_calculations_documentDate_idx";

-- DropIndex
DROP INDEX "payroll_payments_documentDate_idx";

-- DropIndex
DROP INDEX "purchases_documentDate_idx";

-- DropIndex
DROP INDEX "sales_documentDate_idx";

-- AlterTable
ALTER TABLE "cash_expense_orders" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "cash_receipt_orders" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "incoming_invoices" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "inventory_transfers" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "outgoing_invoices" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "payment_invoices" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "payroll_calculations" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "payroll_payments" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "purchases" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "sales" DROP COLUMN "documentDate",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "cash_expense_orders_date_idx" ON "cash_expense_orders"("date");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_date_idx" ON "cash_receipt_orders"("date");

-- CreateIndex
CREATE INDEX "incoming_invoices_date_idx" ON "incoming_invoices"("date");

-- CreateIndex
CREATE INDEX "inventory_transfers_date_idx" ON "inventory_transfers"("date");

-- CreateIndex
CREATE INDEX "outgoing_invoices_date_idx" ON "outgoing_invoices"("date");

-- CreateIndex
CREATE INDEX "payment_invoices_date_idx" ON "payment_invoices"("date");

-- CreateIndex
CREATE INDEX "payroll_calculations_date_idx" ON "payroll_calculations"("date");

-- CreateIndex
CREATE INDEX "payroll_payments_date_idx" ON "payroll_payments"("date");

-- CreateIndex
CREATE INDEX "purchases_date_idx" ON "purchases"("date");

-- CreateIndex
CREATE INDEX "sales_date_idx" ON "sales"("date");
