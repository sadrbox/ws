-- AlterTable
ALTER TABLE "cash_expense_orders" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cash_receipt_orders" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "incoming_invoices" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "outgoing_invoices" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "payment_invoices" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "payroll_calculations" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "payroll_payments" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "scheduled_tasks" ADD COLUMN     "authorUuid" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "cash_expense_orders_authorUuid_idx" ON "cash_expense_orders"("authorUuid");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_authorUuid_idx" ON "cash_receipt_orders"("authorUuid");

-- CreateIndex
CREATE INDEX "incoming_invoices_authorUuid_idx" ON "incoming_invoices"("authorUuid");

-- CreateIndex
CREATE INDEX "inventory_transfers_authorUuid_idx" ON "inventory_transfers"("authorUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoices_authorUuid_idx" ON "outgoing_invoices"("authorUuid");

-- CreateIndex
CREATE INDEX "payment_invoices_authorUuid_idx" ON "payment_invoices"("authorUuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_authorUuid_idx" ON "payroll_calculations"("authorUuid");

-- CreateIndex
CREATE INDEX "payroll_payments_authorUuid_idx" ON "payroll_payments"("authorUuid");

-- CreateIndex
CREATE INDEX "purchases_authorUuid_idx" ON "purchases"("authorUuid");

-- CreateIndex
CREATE INDEX "sales_authorUuid_idx" ON "sales"("authorUuid");

-- CreateIndex
CREATE INDEX "scheduled_tasks_authorUuid_idx" ON "scheduled_tasks"("authorUuid");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoices" ADD CONSTRAINT "outgoing_invoices_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoices" ADD CONSTRAINT "incoming_invoices_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_receipt_orders" ADD CONSTRAINT "cash_receipt_orders_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_expense_orders" ADD CONSTRAINT "cash_expense_orders_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculations" ADD CONSTRAINT "payroll_calculations_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

