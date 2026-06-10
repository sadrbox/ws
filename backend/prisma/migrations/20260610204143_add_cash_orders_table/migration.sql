-- CreateTable
CREATE TABLE "cash_orders" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "cashboxUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "cash_orders_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "cash_orders_uuid_key" ON "cash_orders"("uuid");
-- CreateIndex
CREATE INDEX "cash_orders_organizationUuid_idx" ON "cash_orders"("organizationUuid");
-- CreateIndex
CREATE INDEX "cash_orders_counterpartyUuid_idx" ON "cash_orders"("counterpartyUuid");
-- CreateIndex
CREATE INDEX "cash_orders_contractUuid_idx" ON "cash_orders"("contractUuid");
-- CreateIndex
CREATE INDEX "cash_orders_cashboxUuid_idx" ON "cash_orders"("cashboxUuid");
-- CreateIndex
CREATE INDEX "cash_orders_authorUuid_idx" ON "cash_orders"("authorUuid");
-- CreateIndex
CREATE INDEX "cash_orders_direction_idx" ON "cash_orders"("direction");
-- CreateIndex
CREATE INDEX "cash_orders_date_idx" ON "cash_orders"("date");
-- CreateIndex
CREATE INDEX "cash_orders_updatedAt_idx" ON "cash_orders"("updatedAt");
-- AddForeignKey
ALTER TABLE "cash_orders" ADD CONSTRAINT "cash_orders_cashboxUuid_fkey" FOREIGN KEY ("cashboxUuid") REFERENCES "cashboxes"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cash_orders" ADD CONSTRAINT "cash_orders_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cash_orders" ADD CONSTRAINT "cash_orders_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cash_orders" ADD CONSTRAINT "cash_orders_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "cash_orders" ADD CONSTRAINT "cash_orders_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
