-- CreateTable: warehouses
CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "shortName" TEXT NOT NULL,
  "address" TEXT,
  "description" TEXT,
  "organizationUuid" TEXT,
  CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_uuid_key" ON "warehouses"("uuid");

CREATE INDEX IF NOT EXISTS "warehouses_organizationUuid_idx" ON "warehouses"("organizationUuid");

ALTER TABLE
  "warehouses"
ADD
  CONSTRAINT "warehouses_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: sales
CREATE TABLE IF NOT EXISTS "sales" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "amount" DECIMAL(18, 2),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "organizationUuid" TEXT,
  "counterpartyUuid" TEXT,
  "contractUuid" TEXT,
  "ownerName" TEXT,
  CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_uuid_key" ON "sales"("uuid");

CREATE INDEX IF NOT EXISTS "sales_organizationUuid_idx" ON "sales"("organizationUuid");

CREATE INDEX IF NOT EXISTS "sales_counterpartyUuid_idx" ON "sales"("counterpartyUuid");

CREATE INDEX IF NOT EXISTS "sales_documentDate_idx" ON "sales"("documentDate");

ALTER TABLE
  "sales"
ADD
  CONSTRAINT "sales_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "sales"
ADD
  CONSTRAINT "sales_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: purchases
CREATE TABLE IF NOT EXISTS "purchases" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "amount" DECIMAL(18, 2),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "organizationUuid" TEXT,
  "counterpartyUuid" TEXT,
  "contractUuid" TEXT,
  "ownerName" TEXT,
  CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchases_uuid_key" ON "purchases"("uuid");

CREATE INDEX IF NOT EXISTS "purchases_organizationUuid_idx" ON "purchases"("organizationUuid");

CREATE INDEX IF NOT EXISTS "purchases_counterpartyUuid_idx" ON "purchases"("counterpartyUuid");

CREATE INDEX IF NOT EXISTS "purchases_documentDate_idx" ON "purchases"("documentDate");

ALTER TABLE
  "purchases"
ADD
  CONSTRAINT "purchases_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "purchases"
ADD
  CONSTRAINT "purchases_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: outgoing_invoices
CREATE TABLE IF NOT EXISTS "outgoing_invoices" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "amount" DECIMAL(18, 2),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "organizationUuid" TEXT,
  "counterpartyUuid" TEXT,
  "ownerName" TEXT,
  CONSTRAINT "outgoing_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "outgoing_invoices_uuid_key" ON "outgoing_invoices"("uuid");

CREATE INDEX IF NOT EXISTS "outgoing_invoices_organizationUuid_idx" ON "outgoing_invoices"("organizationUuid");

CREATE INDEX IF NOT EXISTS "outgoing_invoices_counterpartyUuid_idx" ON "outgoing_invoices"("counterpartyUuid");

CREATE INDEX IF NOT EXISTS "outgoing_invoices_documentDate_idx" ON "outgoing_invoices"("documentDate");

ALTER TABLE
  "outgoing_invoices"
ADD
  CONSTRAINT "outgoing_invoices_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "outgoing_invoices"
ADD
  CONSTRAINT "outgoing_invoices_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: incoming_invoices
CREATE TABLE IF NOT EXISTS "incoming_invoices" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "amount" DECIMAL(18, 2),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "organizationUuid" TEXT,
  "counterpartyUuid" TEXT,
  "ownerName" TEXT,
  CONSTRAINT "incoming_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "incoming_invoices_uuid_key" ON "incoming_invoices"("uuid");

CREATE INDEX IF NOT EXISTS "incoming_invoices_organizationUuid_idx" ON "incoming_invoices"("organizationUuid");

CREATE INDEX IF NOT EXISTS "incoming_invoices_counterpartyUuid_idx" ON "incoming_invoices"("counterpartyUuid");

CREATE INDEX IF NOT EXISTS "incoming_invoices_documentDate_idx" ON "incoming_invoices"("documentDate");

ALTER TABLE
  "incoming_invoices"
ADD
  CONSTRAINT "incoming_invoices_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "incoming_invoices"
ADD
  CONSTRAINT "incoming_invoices_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: payment_invoices
CREATE TABLE IF NOT EXISTS "payment_invoices" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "amount" DECIMAL(18, 2),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "organizationUuid" TEXT,
  "counterpartyUuid" TEXT,
  "ownerName" TEXT,
  CONSTRAINT "payment_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_invoices_uuid_key" ON "payment_invoices"("uuid");

CREATE INDEX IF NOT EXISTS "payment_invoices_organizationUuid_idx" ON "payment_invoices"("organizationUuid");

CREATE INDEX IF NOT EXISTS "payment_invoices_counterpartyUuid_idx" ON "payment_invoices"("counterpartyUuid");

CREATE INDEX IF NOT EXISTS "payment_invoices_documentDate_idx" ON "payment_invoices"("documentDate");

ALTER TABLE
  "payment_invoices"
ADD
  CONSTRAINT "payment_invoices_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "payment_invoices"
ADD
  CONSTRAINT "payment_invoices_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: scheduled_tasks
CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "shortName" TEXT NOT NULL,
  "description" TEXT,
  "cronExpr" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "organizationUuid" TEXT,
  CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_tasks_uuid_key" ON "scheduled_tasks"("uuid");

CREATE INDEX IF NOT EXISTS "scheduled_tasks_organizationUuid_idx" ON "scheduled_tasks"("organizationUuid");

CREATE INDEX IF NOT EXISTS "scheduled_tasks_status_idx" ON "scheduled_tasks"("status");

ALTER TABLE
  "scheduled_tasks"
ADD
  CONSTRAINT "scheduled_tasks_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: inventory_transfers
CREATE TABLE IF NOT EXISTS "inventory_transfers" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "fromWarehouseUuid" TEXT,
  "toWarehouseUuid" TEXT,
  "organizationUuid" TEXT,
  "ownerName" TEXT,
  CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfers_uuid_key" ON "inventory_transfers"("uuid");

CREATE INDEX IF NOT EXISTS "inventory_transfers_fromWarehouseUuid_idx" ON "inventory_transfers"("fromWarehouseUuid");

CREATE INDEX IF NOT EXISTS "inventory_transfers_toWarehouseUuid_idx" ON "inventory_transfers"("toWarehouseUuid");

CREATE INDEX IF NOT EXISTS "inventory_transfers_organizationUuid_idx" ON "inventory_transfers"("organizationUuid");

CREATE INDEX IF NOT EXISTS "inventory_transfers_documentDate_idx" ON "inventory_transfers"("documentDate");

ALTER TABLE
  "inventory_transfers"
ADD
  CONSTRAINT "inventory_transfers_fromWarehouseUuid_fkey" FOREIGN KEY ("fromWarehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "inventory_transfers"
ADD
  CONSTRAINT "inventory_transfers_toWarehouseUuid_fkey" FOREIGN KEY ("toWarehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "inventory_transfers"
ADD
  CONSTRAINT "inventory_transfers_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: cash_receipt_orders
CREATE TABLE IF NOT EXISTS "cash_receipt_orders" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "amount" DECIMAL(18, 2),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "organizationUuid" TEXT,
  "counterpartyUuid" TEXT,
  "ownerName" TEXT,
  CONSTRAINT "cash_receipt_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_receipt_orders_uuid_key" ON "cash_receipt_orders"("uuid");

CREATE INDEX IF NOT EXISTS "cash_receipt_orders_organizationUuid_idx" ON "cash_receipt_orders"("organizationUuid");

CREATE INDEX IF NOT EXISTS "cash_receipt_orders_counterpartyUuid_idx" ON "cash_receipt_orders"("counterpartyUuid");

CREATE INDEX IF NOT EXISTS "cash_receipt_orders_documentDate_idx" ON "cash_receipt_orders"("documentDate");

ALTER TABLE
  "cash_receipt_orders"
ADD
  CONSTRAINT "cash_receipt_orders_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "cash_receipt_orders"
ADD
  CONSTRAINT "cash_receipt_orders_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- CreateTable: cash_expense_orders
CREATE TABLE IF NOT EXISTS "cash_expense_orders" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "amount" DECIMAL(18, 2),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "organizationUuid" TEXT,
  "counterpartyUuid" TEXT,
  "ownerName" TEXT,
  CONSTRAINT "cash_expense_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_expense_orders_uuid_key" ON "cash_expense_orders"("uuid");

CREATE INDEX IF NOT EXISTS "cash_expense_orders_organizationUuid_idx" ON "cash_expense_orders"("organizationUuid");

CREATE INDEX IF NOT EXISTS "cash_expense_orders_counterpartyUuid_idx" ON "cash_expense_orders"("counterpartyUuid");

CREATE INDEX IF NOT EXISTS "cash_expense_orders_documentDate_idx" ON "cash_expense_orders"("documentDate");

ALTER TABLE
  "cash_expense_orders"
ADD
  CONSTRAINT "cash_expense_orders_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

ALTER TABLE
  "cash_expense_orders"
ADD
  CONSTRAINT "cash_expense_orders_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;