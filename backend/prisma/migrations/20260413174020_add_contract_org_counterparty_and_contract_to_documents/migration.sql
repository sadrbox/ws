/*
  Warnings:

  - You are about to drop the column `ownerName` on the `bank_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `cash_expense_orders` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `cash_receipt_orders` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `incoming_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `inventory_transfers` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `outgoing_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `payment_invoices` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `purchases` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `sales` table. All the data in the column will be lost.
  - You are about to drop the column `ownerName` on the `todos` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bank_accounts" DROP COLUMN "ownerName";

-- AlterTable
ALTER TABLE "cash_expense_orders" DROP COLUMN "ownerName",
ADD COLUMN     "contractUuid" TEXT;

-- AlterTable
ALTER TABLE "cash_receipt_orders" DROP COLUMN "ownerName",
ADD COLUMN     "contractUuid" TEXT;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "counterpartyUuid" TEXT,
ADD COLUMN     "organizationUuid" TEXT;

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "email",
DROP COLUMN "phone";

-- AlterTable
ALTER TABLE "incoming_invoices" DROP COLUMN "ownerName",
ADD COLUMN     "contractUuid" TEXT;

-- AlterTable
ALTER TABLE "inventory_transfers" DROP COLUMN "ownerName";

-- AlterTable
ALTER TABLE "outgoing_invoices" DROP COLUMN "ownerName",
ADD COLUMN     "contractUuid" TEXT;

-- AlterTable
ALTER TABLE "payment_invoices" DROP COLUMN "ownerName",
ADD COLUMN     "contractUuid" TEXT;

-- AlterTable
ALTER TABLE "purchases" DROP COLUMN "ownerName";

-- AlterTable
ALTER TABLE "sales" DROP COLUMN "ownerName";

-- AlterTable
ALTER TABLE "todos" DROP COLUMN "ownerName";

-- CreateIndex
CREATE INDEX "cash_expense_orders_contractUuid_idx" ON "cash_expense_orders"("contractUuid");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_contractUuid_idx" ON "cash_receipt_orders"("contractUuid");

-- CreateIndex
CREATE INDEX "contracts_organizationUuid_idx" ON "contracts"("organizationUuid");

-- CreateIndex
CREATE INDEX "contracts_counterpartyUuid_idx" ON "contracts"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "incoming_invoices_contractUuid_idx" ON "incoming_invoices"("contractUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoices_contractUuid_idx" ON "outgoing_invoices"("contractUuid");

-- CreateIndex
CREATE INDEX "payment_invoices_contractUuid_idx" ON "payment_invoices"("contractUuid");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoices" ADD CONSTRAINT "outgoing_invoices_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoices" ADD CONSTRAINT "incoming_invoices_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_receipt_orders" ADD CONSTRAINT "cash_receipt_orders_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_expense_orders" ADD CONSTRAINT "cash_expense_orders_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
