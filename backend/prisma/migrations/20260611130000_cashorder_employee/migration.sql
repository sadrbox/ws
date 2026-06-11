-- AlterTable: подотчётное лицо в кассовом ордере (счёт 1250)
ALTER TABLE "cash_orders" ADD COLUMN "employeeUuid" TEXT;

-- CreateIndex
CREATE INDEX "cash_orders_employeeUuid_idx" ON "cash_orders"("employeeUuid");

-- AddForeignKey
ALTER TABLE "cash_orders" ADD CONSTRAINT "cash_orders_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
