-- Add isPrimary to warehouses
ALTER TABLE "warehouses" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "warehouses_organizationUuid_isPrimary_idx" ON "warehouses"("organizationUuid", "isPrimary");

-- CreateTable: cashboxes
CREATE TABLE "cashboxes" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "cashboxes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cashboxes_uuid_key" ON "cashboxes"("uuid");
CREATE INDEX "cashboxes_organizationUuid_idx" ON "cashboxes"("organizationUuid");
CREATE INDEX "cashboxes_organizationUuid_isPrimary_idx" ON "cashboxes"("organizationUuid", "isPrimary");
CREATE INDEX "cashboxes_updatedAt_idx" ON "cashboxes"("updatedAt");
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add cashboxUuid to cash_receipt_orders
ALTER TABLE "cash_receipt_orders" ADD COLUMN "cashboxUuid" TEXT;
CREATE INDEX "cash_receipt_orders_cashboxUuid_idx" ON "cash_receipt_orders"("cashboxUuid");
ALTER TABLE "cash_receipt_orders" ADD CONSTRAINT "cash_receipt_orders_cashboxUuid_fkey" FOREIGN KEY ("cashboxUuid") REFERENCES "cashboxes"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add cashboxUuid to cash_expense_orders
ALTER TABLE "cash_expense_orders" ADD COLUMN "cashboxUuid" TEXT;
CREATE INDEX "cash_expense_orders_cashboxUuid_idx" ON "cash_expense_orders"("cashboxUuid");
ALTER TABLE "cash_expense_orders" ADD CONSTRAINT "cash_expense_orders_cashboxUuid_fkey" FOREIGN KEY ("cashboxUuid") REFERENCES "cashboxes"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
