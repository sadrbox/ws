-- AlterTable
ALTER TABLE "access_rights" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "attached_files" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "cash_expense_orders" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "cash_receipt_orders" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "contact_persons" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "contact_types" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "counterparties" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "currencies" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "employee_history" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "incoming_invoices" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "outgoing_invoices" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "payment_invoices" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unitOfMeasure" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "amountWithoutVat" DECIMAL(18,2),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "vatAmount" DECIMAL(18,2),
ADD COLUMN     "warehouseUuid" TEXT;

-- AlterTable
ALTER TABLE "scheduled_tasks" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "todos" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "payroll_calculations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "documentNumber" TEXT,
    "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "period" VARCHAR(7),
    "employeeUuid" TEXT,
    "organizationUuid" TEXT,
    "positionUuid" TEXT,
    "baseSalary" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "opv" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ipn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "socialContrib" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "socialTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vosms" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "oosms" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalExpense" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "documentNumber" TEXT,
    "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "period" VARCHAR(7),
    "employeeUuid" TEXT,
    "organizationUuid" TEXT,
    "paymentMethod" TEXT DEFAULT 'bank_transfer',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_calculations_uuid_key" ON "payroll_calculations"("uuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_employeeUuid_idx" ON "payroll_calculations"("employeeUuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_organizationUuid_idx" ON "payroll_calculations"("organizationUuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_positionUuid_idx" ON "payroll_calculations"("positionUuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_documentDate_idx" ON "payroll_calculations"("documentDate");

-- CreateIndex
CREATE INDEX "payroll_calculations_period_idx" ON "payroll_calculations"("period");

-- CreateIndex
CREATE INDEX "payroll_calculations_updatedAt_idx" ON "payroll_calculations"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_payments_uuid_key" ON "payroll_payments"("uuid");

-- CreateIndex
CREATE INDEX "payroll_payments_employeeUuid_idx" ON "payroll_payments"("employeeUuid");

-- CreateIndex
CREATE INDEX "payroll_payments_organizationUuid_idx" ON "payroll_payments"("organizationUuid");

-- CreateIndex
CREATE INDEX "payroll_payments_documentDate_idx" ON "payroll_payments"("documentDate");

-- CreateIndex
CREATE INDEX "payroll_payments_period_idx" ON "payroll_payments"("period");

-- CreateIndex
CREATE INDEX "payroll_payments_updatedAt_idx" ON "payroll_payments"("updatedAt");

-- CreateIndex
CREATE INDEX "access_rights_updatedAt_idx" ON "access_rights"("updatedAt");

-- CreateIndex
CREATE INDEX "attached_files_updatedAt_idx" ON "attached_files"("updatedAt");

-- CreateIndex
CREATE INDEX "bank_accounts_updatedAt_idx" ON "bank_accounts"("updatedAt");

-- CreateIndex
CREATE INDEX "brands_updatedAt_idx" ON "brands"("updatedAt");

-- CreateIndex
CREATE INDEX "cash_expense_orders_updatedAt_idx" ON "cash_expense_orders"("updatedAt");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_updatedAt_idx" ON "cash_receipt_orders"("updatedAt");

-- CreateIndex
CREATE INDEX "contact_persons_updatedAt_idx" ON "contact_persons"("updatedAt");

-- CreateIndex
CREATE INDEX "contact_types_updatedAt_idx" ON "contact_types"("updatedAt");

-- CreateIndex
CREATE INDEX "contacts_updatedAt_idx" ON "contacts"("updatedAt");

-- CreateIndex
CREATE INDEX "contracts_updatedAt_idx" ON "contracts"("updatedAt");

-- CreateIndex
CREATE INDEX "counterparties_updatedAt_idx" ON "counterparties"("updatedAt");

-- CreateIndex
CREATE INDEX "currencies_updatedAt_idx" ON "currencies"("updatedAt");

-- CreateIndex
CREATE INDEX "employee_history_updatedAt_idx" ON "employee_history"("updatedAt");

-- CreateIndex
CREATE INDEX "employees_updatedAt_idx" ON "employees"("updatedAt");

-- CreateIndex
CREATE INDEX "incoming_invoices_updatedAt_idx" ON "incoming_invoices"("updatedAt");

-- CreateIndex
CREATE INDEX "inventory_transfers_updatedAt_idx" ON "inventory_transfers"("updatedAt");

-- CreateIndex
CREATE INDEX "notifications_updatedAt_idx" ON "notifications"("updatedAt");

-- CreateIndex
CREATE INDEX "organizations_updatedAt_idx" ON "organizations"("updatedAt");

-- CreateIndex
CREATE INDEX "outgoing_invoices_updatedAt_idx" ON "outgoing_invoices"("updatedAt");

-- CreateIndex
CREATE INDEX "payment_invoices_updatedAt_idx" ON "payment_invoices"("updatedAt");

-- CreateIndex
CREATE INDEX "positions_updatedAt_idx" ON "positions"("updatedAt");

-- CreateIndex
CREATE INDEX "products_updatedAt_idx" ON "products"("updatedAt");

-- CreateIndex
CREATE INDEX "purchases_updatedAt_idx" ON "purchases"("updatedAt");

-- CreateIndex
CREATE INDEX "sale_items_updatedAt_idx" ON "sale_items"("updatedAt");

-- CreateIndex
CREATE INDEX "sales_warehouseUuid_idx" ON "sales"("warehouseUuid");

-- CreateIndex
CREATE INDEX "sales_updatedAt_idx" ON "sales"("updatedAt");

-- CreateIndex
CREATE INDEX "scheduled_tasks_updatedAt_idx" ON "scheduled_tasks"("updatedAt");

-- CreateIndex
CREATE INDEX "todos_updatedAt_idx" ON "todos"("updatedAt");

-- CreateIndex
CREATE INDEX "users_updatedAt_idx" ON "users"("updatedAt");

-- CreateIndex
CREATE INDEX "warehouses_updatedAt_idx" ON "warehouses"("updatedAt");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculations" ADD CONSTRAINT "payroll_calculations_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculations" ADD CONSTRAINT "payroll_calculations_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculations" ADD CONSTRAINT "payroll_calculations_positionUuid_fkey" FOREIGN KEY ("positionUuid") REFERENCES "positions"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
