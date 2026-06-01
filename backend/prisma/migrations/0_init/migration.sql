-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('legal_address', 'actual_address', 'telephone', 'whatsapp', 'telegram', 'instagram', 'facebook', 'email', 'website', 'fax', 'other');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "password" TEXT,
    "employeeUuid" TEXT,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "avatarPath" TEXT,
    "organizationUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permission_defaults" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "valueUuid" TEXT NOT NULL,
    "valueName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "bin" VARCHAR(12) NOT NULL,
    "name" TEXT,
    "legalName" TEXT,
    "inviteCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparties" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "bin" VARCHAR(12) NOT NULL,
    "name" TEXT,
    "legalName" TEXT,
    "organizationUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractNumber" TEXT,
    "contractText" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attached_files" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerUuid" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "comment" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "attached_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "contactType" "ContactType" NOT NULL,
    "ownerType" TEXT,
    "ownerUuid" TEXT,
    "organizationUuid" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_persons" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,
    "fullName" VARCHAR(255),
    "ownerType" TEXT,
    "ownerUuid" TEXT,
    "organizationUuid" TEXT,
    "comment" TEXT,
    "avatarPath" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "ownerType" TEXT,
    "ownerUuid" TEXT,
    "iban" TEXT NOT NULL,
    "bik" TEXT,
    "bankName" TEXT,
    "name" TEXT,
    "currencyUuid" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_history" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "actionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionType" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "organizationShortName" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "ip" TEXT,
    "city" TEXT,
    "objectId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "props" JSONB,

    CONSTRAINT "activity_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todos" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "curatorUuid" TEXT,
    "executorUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "deadlineDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'new',

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "comment" TEXT,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashboxes" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "cashboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outgoing_invoices" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,

    CONSTRAINT "outgoing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_invoices" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "incoming_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_invoices" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payment_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cronExpr" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "organizationUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transfers" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "fromWarehouseUuid" TEXT,
    "toWarehouseUuid" TEXT,
    "organizationUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_receipt_orders" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
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

    CONSTRAINT "cash_receipt_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_expense_orders" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
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

    CONSTRAINT "cash_expense_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "brandUuid" TEXT,
    "unitOfMeasureUuid" TEXT,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "saleUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "purchaseUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outgoing_invoice_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "outgoingInvoiceUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "outgoing_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_invoice_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "incomingInvoiceUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "incoming_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_invoice_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "paymentInvoiceUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payment_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transfer_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "productUuid" TEXT,
    "inventoryTransferUuid" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,
    "fullName" VARCHAR(255),
    "iin" VARCHAR(12),
    "avatarPath" TEXT,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "comment" TEXT,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_history" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "salary" DECIMAL(18,2),
    "employeeUuid" TEXT NOT NULL,
    "positionUuid" TEXT,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "employee_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_rights" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'none',
    "userUuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "access_rights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_calculations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
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
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "period" VARCHAR(7),
    "employeeUuid" TEXT,
    "organizationUuid" TEXT,
    "paymentMethod" TEXT DEFAULT 'bank_transfer',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxes" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "rate" DECIMAL(5,2),
    "calculationMethod" TEXT NOT NULL DEFAULT 'INCLUDED',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_accounting_settings" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "useVat" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatCalculationMethod" TEXT NOT NULL DEFAULT 'INCLUDED',
    "useDiscount" BOOLEAN NOT NULL DEFAULT false,
    "useExcise" BOOLEAN NOT NULL DEFAULT false,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organization_accounting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "saleReturnUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "purchaseReturnUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "purchaseRequisitionUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_requisition_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_register" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "movementType" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "warehouseUuid" TEXT,
    "organizationUuid" TEXT,
    "unitOfMeasureUuid" TEXT,
    "documentType" TEXT NOT NULL,
    "documentUuid" TEXT NOT NULL,
    "documentId" INTEGER,
    "documentItemUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subkonto_types" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referenceEndpoint" TEXT,
    "referenceModel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "subkonto_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'active',
    "parentUuid" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isCurrency" BOOLEAN NOT NULL DEFAULT false,
    "isQuantitative" BOOLEAN NOT NULL DEFAULT false,
    "isOffBalance" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "subkonto1Type" TEXT,
    "subkonto2Type" TEXT,
    "subkonto3Type" TEXT,
    "organizationUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entries" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "documentType" TEXT NOT NULL,
    "documentUuid" TEXT NOT NULL,
    "documentId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "debitAccountUuid" TEXT,
    "debitAccountCode" TEXT NOT NULL,
    "creditAccountUuid" TEXT,
    "creditAccountCode" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_entry_analytics" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "accountingEntryUuid" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "subkontoType" TEXT NOT NULL,
    "objectUuid" TEXT,
    "objectName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_entry_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_offers" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "commercial_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_offer_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "commercialOfferUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "commercial_offer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "salesOrderUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "reservationUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "reservation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "amountWithoutVat" DECIMAL(18,2),
    "vatAmount" DECIMAL(18,2),
    "discountAmount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountWithoutVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitOfMeasureUuid" TEXT,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exciseRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "exciseAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "purchaseOrderUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "date" TIMESTAMP(3),
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'in',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "contractUuid" TEXT,
    "bankAccountUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "basisDocumentType" TEXT,
    "basisDocumentUuid" TEXT,
    "basisDocumentLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");

-- CreateIndex
CREATE INDEX "users_employeeUuid_idx" ON "users"("employeeUuid");

-- CreateIndex
CREATE INDEX "users_organizationUuid_idx" ON "users"("organizationUuid");

-- CreateIndex
CREATE INDEX "users_updatedAt_idx" ON "users"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_uuid_key" ON "user_permissions"("uuid");

-- CreateIndex
CREATE INDEX "user_permissions_userUuid_idx" ON "user_permissions"("userUuid");

-- CreateIndex
CREATE INDEX "user_permissions_organizationUuid_idx" ON "user_permissions"("organizationUuid");

-- CreateIndex
CREATE INDEX "user_permissions_updatedAt_idx" ON "user_permissions"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_userUuid_organizationUuid_key" ON "user_permissions"("userUuid", "organizationUuid");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_defaults_uuid_key" ON "user_permission_defaults"("uuid");

-- CreateIndex
CREATE INDEX "user_permission_defaults_userUuid_idx" ON "user_permission_defaults"("userUuid");

-- CreateIndex
CREATE INDEX "user_permission_defaults_organizationUuid_idx" ON "user_permission_defaults"("organizationUuid");

-- CreateIndex
CREATE INDEX "user_permission_defaults_updatedAt_idx" ON "user_permission_defaults"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_defaults_userUuid_organizationUuid_valueTyp_key" ON "user_permission_defaults"("userUuid", "organizationUuid", "valueType");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_uuid_key" ON "organizations"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_bin_key" ON "organizations"("bin");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_inviteCode_key" ON "organizations"("inviteCode");

-- CreateIndex
CREATE INDEX "organizations_updatedAt_idx" ON "organizations"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_uuid_key" ON "counterparties"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_bin_key" ON "counterparties"("bin");

-- CreateIndex
CREATE INDEX "counterparties_organizationUuid_idx" ON "counterparties"("organizationUuid");

-- CreateIndex
CREATE INDEX "counterparties_updatedAt_idx" ON "counterparties"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_uuid_key" ON "contracts"("uuid");

-- CreateIndex
CREATE INDEX "contracts_organizationUuid_idx" ON "contracts"("organizationUuid");

-- CreateIndex
CREATE INDEX "contracts_counterpartyUuid_idx" ON "contracts"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "contracts_updatedAt_idx" ON "contracts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "attached_files_uuid_key" ON "attached_files"("uuid");

-- CreateIndex
CREATE INDEX "attached_files_ownerType_ownerUuid_idx" ON "attached_files"("ownerType", "ownerUuid");

-- CreateIndex
CREATE INDEX "attached_files_updatedAt_idx" ON "attached_files"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_uuid_key" ON "contacts"("uuid");

-- CreateIndex
CREATE INDEX "contacts_ownerType_ownerUuid_idx" ON "contacts"("ownerType", "ownerUuid");

-- CreateIndex
CREATE INDEX "contacts_contactType_ownerType_ownerUuid_isPrimary_idx" ON "contacts"("contactType", "ownerType", "ownerUuid", "isPrimary");

-- CreateIndex
CREATE INDEX "contacts_organizationUuid_idx" ON "contacts"("organizationUuid");

-- CreateIndex
CREATE INDEX "contacts_updatedAt_idx" ON "contacts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contact_persons_uuid_key" ON "contact_persons"("uuid");

-- CreateIndex
CREATE INDEX "contact_persons_ownerType_ownerUuid_idx" ON "contact_persons"("ownerType", "ownerUuid");

-- CreateIndex
CREATE INDEX "contact_persons_organizationUuid_idx" ON "contact_persons"("organizationUuid");

-- CreateIndex
CREATE INDEX "contact_persons_updatedAt_idx" ON "contact_persons"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_uuid_key" ON "bank_accounts"("uuid");

-- CreateIndex
CREATE INDEX "bank_accounts_ownerType_ownerUuid_idx" ON "bank_accounts"("ownerType", "ownerUuid");

-- CreateIndex
CREATE INDEX "bank_accounts_currencyUuid_idx" ON "bank_accounts"("currencyUuid");

-- CreateIndex
CREATE INDEX "bank_accounts_organizationUuid_idx" ON "bank_accounts"("organizationUuid");

-- CreateIndex
CREATE INDEX "bank_accounts_iban_idx" ON "bank_accounts"("iban");

-- CreateIndex
CREATE INDEX "bank_accounts_bik_idx" ON "bank_accounts"("bik");

-- CreateIndex
CREATE INDEX "bank_accounts_updatedAt_idx" ON "bank_accounts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "activity_history_uuid_key" ON "activity_history"("uuid");

-- CreateIndex
CREATE INDEX "activity_history_actionDate_idx" ON "activity_history"("actionDate");

-- CreateIndex
CREATE INDEX "activity_history_organizationUuid_idx" ON "activity_history"("organizationUuid");

-- CreateIndex
CREATE INDEX "activity_history_objectType_objectId_idx" ON "activity_history"("objectType", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "todos_uuid_key" ON "todos"("uuid");

-- CreateIndex
CREATE INDEX "todos_organizationUuid_idx" ON "todos"("organizationUuid");

-- CreateIndex
CREATE INDEX "todos_counterpartyUuid_idx" ON "todos"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "todos_curatorUuid_idx" ON "todos"("curatorUuid");

-- CreateIndex
CREATE INDEX "todos_executorUuid_idx" ON "todos"("executorUuid");

-- CreateIndex
CREATE INDEX "todos_status_idx" ON "todos"("status");

-- CreateIndex
CREATE INDEX "todos_updatedAt_idx" ON "todos"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_uuid_key" ON "warehouses"("uuid");

-- CreateIndex
CREATE INDEX "warehouses_organizationUuid_idx" ON "warehouses"("organizationUuid");

-- CreateIndex
CREATE INDEX "warehouses_updatedAt_idx" ON "warehouses"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cashboxes_uuid_key" ON "cashboxes"("uuid");

-- CreateIndex
CREATE INDEX "cashboxes_organizationUuid_idx" ON "cashboxes"("organizationUuid");

-- CreateIndex
CREATE INDEX "cashboxes_updatedAt_idx" ON "cashboxes"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sales_uuid_key" ON "sales"("uuid");

-- CreateIndex
CREATE INDEX "sales_organizationUuid_idx" ON "sales"("organizationUuid");

-- CreateIndex
CREATE INDEX "sales_counterpartyUuid_idx" ON "sales"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "sales_contractUuid_idx" ON "sales"("contractUuid");

-- CreateIndex
CREATE INDEX "sales_warehouseUuid_idx" ON "sales"("warehouseUuid");

-- CreateIndex
CREATE INDEX "sales_authorUuid_idx" ON "sales"("authorUuid");

-- CreateIndex
CREATE INDEX "sales_date_idx" ON "sales"("date");

-- CreateIndex
CREATE INDEX "sales_updatedAt_idx" ON "sales"("updatedAt");

-- CreateIndex
CREATE INDEX "sales_basisDocumentUuid_idx" ON "sales"("basisDocumentUuid");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_uuid_key" ON "purchases"("uuid");

-- CreateIndex
CREATE INDEX "purchases_organizationUuid_idx" ON "purchases"("organizationUuid");

-- CreateIndex
CREATE INDEX "purchases_counterpartyUuid_idx" ON "purchases"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "purchases_contractUuid_idx" ON "purchases"("contractUuid");

-- CreateIndex
CREATE INDEX "purchases_warehouseUuid_idx" ON "purchases"("warehouseUuid");

-- CreateIndex
CREATE INDEX "purchases_authorUuid_idx" ON "purchases"("authorUuid");

-- CreateIndex
CREATE INDEX "purchases_date_idx" ON "purchases"("date");

-- CreateIndex
CREATE INDEX "purchases_updatedAt_idx" ON "purchases"("updatedAt");

-- CreateIndex
CREATE INDEX "purchases_basisDocumentUuid_idx" ON "purchases"("basisDocumentUuid");

-- CreateIndex
CREATE UNIQUE INDEX "outgoing_invoices_uuid_key" ON "outgoing_invoices"("uuid");

-- CreateIndex
CREATE INDEX "outgoing_invoices_organizationUuid_idx" ON "outgoing_invoices"("organizationUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoices_counterpartyUuid_idx" ON "outgoing_invoices"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoices_contractUuid_idx" ON "outgoing_invoices"("contractUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoices_authorUuid_idx" ON "outgoing_invoices"("authorUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoices_date_idx" ON "outgoing_invoices"("date");

-- CreateIndex
CREATE INDEX "outgoing_invoices_updatedAt_idx" ON "outgoing_invoices"("updatedAt");

-- CreateIndex
CREATE INDEX "outgoing_invoices_basisDocumentUuid_idx" ON "outgoing_invoices"("basisDocumentUuid");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_invoices_uuid_key" ON "incoming_invoices"("uuid");

-- CreateIndex
CREATE INDEX "incoming_invoices_organizationUuid_idx" ON "incoming_invoices"("organizationUuid");

-- CreateIndex
CREATE INDEX "incoming_invoices_counterpartyUuid_idx" ON "incoming_invoices"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "incoming_invoices_contractUuid_idx" ON "incoming_invoices"("contractUuid");

-- CreateIndex
CREATE INDEX "incoming_invoices_authorUuid_idx" ON "incoming_invoices"("authorUuid");

-- CreateIndex
CREATE INDEX "incoming_invoices_date_idx" ON "incoming_invoices"("date");

-- CreateIndex
CREATE INDEX "incoming_invoices_updatedAt_idx" ON "incoming_invoices"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_invoices_uuid_key" ON "payment_invoices"("uuid");

-- CreateIndex
CREATE INDEX "payment_invoices_organizationUuid_idx" ON "payment_invoices"("organizationUuid");

-- CreateIndex
CREATE INDEX "payment_invoices_counterpartyUuid_idx" ON "payment_invoices"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "payment_invoices_contractUuid_idx" ON "payment_invoices"("contractUuid");

-- CreateIndex
CREATE INDEX "payment_invoices_authorUuid_idx" ON "payment_invoices"("authorUuid");

-- CreateIndex
CREATE INDEX "payment_invoices_date_idx" ON "payment_invoices"("date");

-- CreateIndex
CREATE INDEX "payment_invoices_updatedAt_idx" ON "payment_invoices"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_tasks_uuid_key" ON "scheduled_tasks"("uuid");

-- CreateIndex
CREATE INDEX "scheduled_tasks_organizationUuid_idx" ON "scheduled_tasks"("organizationUuid");

-- CreateIndex
CREATE INDEX "scheduled_tasks_authorUuid_idx" ON "scheduled_tasks"("authorUuid");

-- CreateIndex
CREATE INDEX "scheduled_tasks_status_idx" ON "scheduled_tasks"("status");

-- CreateIndex
CREATE INDEX "scheduled_tasks_updatedAt_idx" ON "scheduled_tasks"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfers_uuid_key" ON "inventory_transfers"("uuid");

-- CreateIndex
CREATE INDEX "inventory_transfers_fromWarehouseUuid_idx" ON "inventory_transfers"("fromWarehouseUuid");

-- CreateIndex
CREATE INDEX "inventory_transfers_toWarehouseUuid_idx" ON "inventory_transfers"("toWarehouseUuid");

-- CreateIndex
CREATE INDEX "inventory_transfers_organizationUuid_idx" ON "inventory_transfers"("organizationUuid");

-- CreateIndex
CREATE INDEX "inventory_transfers_authorUuid_idx" ON "inventory_transfers"("authorUuid");

-- CreateIndex
CREATE INDEX "inventory_transfers_date_idx" ON "inventory_transfers"("date");

-- CreateIndex
CREATE INDEX "inventory_transfers_updatedAt_idx" ON "inventory_transfers"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cash_receipt_orders_uuid_key" ON "cash_receipt_orders"("uuid");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_organizationUuid_idx" ON "cash_receipt_orders"("organizationUuid");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_counterpartyUuid_idx" ON "cash_receipt_orders"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_contractUuid_idx" ON "cash_receipt_orders"("contractUuid");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_cashboxUuid_idx" ON "cash_receipt_orders"("cashboxUuid");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_authorUuid_idx" ON "cash_receipt_orders"("authorUuid");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_date_idx" ON "cash_receipt_orders"("date");

-- CreateIndex
CREATE INDEX "cash_receipt_orders_updatedAt_idx" ON "cash_receipt_orders"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cash_expense_orders_uuid_key" ON "cash_expense_orders"("uuid");

-- CreateIndex
CREATE INDEX "cash_expense_orders_organizationUuid_idx" ON "cash_expense_orders"("organizationUuid");

-- CreateIndex
CREATE INDEX "cash_expense_orders_counterpartyUuid_idx" ON "cash_expense_orders"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "cash_expense_orders_contractUuid_idx" ON "cash_expense_orders"("contractUuid");

-- CreateIndex
CREATE INDEX "cash_expense_orders_cashboxUuid_idx" ON "cash_expense_orders"("cashboxUuid");

-- CreateIndex
CREATE INDEX "cash_expense_orders_authorUuid_idx" ON "cash_expense_orders"("authorUuid");

-- CreateIndex
CREATE INDEX "cash_expense_orders_date_idx" ON "cash_expense_orders"("date");

-- CreateIndex
CREATE INDEX "cash_expense_orders_updatedAt_idx" ON "cash_expense_orders"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "brands_uuid_key" ON "brands"("uuid");

-- CreateIndex
CREATE INDEX "brands_organizationUuid_idx" ON "brands"("organizationUuid");

-- CreateIndex
CREATE INDEX "brands_updatedAt_idx" ON "brands"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "products_uuid_key" ON "products"("uuid");

-- CreateIndex
CREATE INDEX "products_brandUuid_idx" ON "products"("brandUuid");

-- CreateIndex
CREATE INDEX "products_unitOfMeasureUuid_idx" ON "products"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "products_organizationUuid_idx" ON "products"("organizationUuid");

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_updatedAt_idx" ON "products"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_uuid_key" ON "sale_items"("uuid");

-- CreateIndex
CREATE INDEX "sale_items_saleUuid_idx" ON "sale_items"("saleUuid");

-- CreateIndex
CREATE INDEX "sale_items_productUuid_idx" ON "sale_items"("productUuid");

-- CreateIndex
CREATE INDEX "sale_items_unitOfMeasureUuid_idx" ON "sale_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "sale_items_date_idx" ON "sale_items"("date");

-- CreateIndex
CREATE INDEX "sale_items_posted_idx" ON "sale_items"("posted");

-- CreateIndex
CREATE INDEX "sale_items_organizationUuid_idx" ON "sale_items"("organizationUuid");

-- CreateIndex
CREATE INDEX "sale_items_counterpartyUuid_idx" ON "sale_items"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "sale_items_updatedAt_idx" ON "sale_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_uuid_key" ON "purchase_items"("uuid");

-- CreateIndex
CREATE INDEX "purchase_items_purchaseUuid_idx" ON "purchase_items"("purchaseUuid");

-- CreateIndex
CREATE INDEX "purchase_items_productUuid_idx" ON "purchase_items"("productUuid");

-- CreateIndex
CREATE INDEX "purchase_items_unitOfMeasureUuid_idx" ON "purchase_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "purchase_items_date_idx" ON "purchase_items"("date");

-- CreateIndex
CREATE INDEX "purchase_items_posted_idx" ON "purchase_items"("posted");

-- CreateIndex
CREATE INDEX "purchase_items_organizationUuid_idx" ON "purchase_items"("organizationUuid");

-- CreateIndex
CREATE INDEX "purchase_items_counterpartyUuid_idx" ON "purchase_items"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "purchase_items_updatedAt_idx" ON "purchase_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "outgoing_invoice_items_uuid_key" ON "outgoing_invoice_items"("uuid");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_outgoingInvoiceUuid_idx" ON "outgoing_invoice_items"("outgoingInvoiceUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_productUuid_idx" ON "outgoing_invoice_items"("productUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_unitOfMeasureUuid_idx" ON "outgoing_invoice_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_date_idx" ON "outgoing_invoice_items"("date");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_posted_idx" ON "outgoing_invoice_items"("posted");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_organizationUuid_idx" ON "outgoing_invoice_items"("organizationUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_counterpartyUuid_idx" ON "outgoing_invoice_items"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "outgoing_invoice_items_updatedAt_idx" ON "outgoing_invoice_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_invoice_items_uuid_key" ON "incoming_invoice_items"("uuid");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_incomingInvoiceUuid_idx" ON "incoming_invoice_items"("incomingInvoiceUuid");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_productUuid_idx" ON "incoming_invoice_items"("productUuid");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_unitOfMeasureUuid_idx" ON "incoming_invoice_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_date_idx" ON "incoming_invoice_items"("date");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_posted_idx" ON "incoming_invoice_items"("posted");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_organizationUuid_idx" ON "incoming_invoice_items"("organizationUuid");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_counterpartyUuid_idx" ON "incoming_invoice_items"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "incoming_invoice_items_updatedAt_idx" ON "incoming_invoice_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_invoice_items_uuid_key" ON "payment_invoice_items"("uuid");

-- CreateIndex
CREATE INDEX "payment_invoice_items_paymentInvoiceUuid_idx" ON "payment_invoice_items"("paymentInvoiceUuid");

-- CreateIndex
CREATE INDEX "payment_invoice_items_productUuid_idx" ON "payment_invoice_items"("productUuid");

-- CreateIndex
CREATE INDEX "payment_invoice_items_unitOfMeasureUuid_idx" ON "payment_invoice_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "payment_invoice_items_date_idx" ON "payment_invoice_items"("date");

-- CreateIndex
CREATE INDEX "payment_invoice_items_posted_idx" ON "payment_invoice_items"("posted");

-- CreateIndex
CREATE INDEX "payment_invoice_items_organizationUuid_idx" ON "payment_invoice_items"("organizationUuid");

-- CreateIndex
CREATE INDEX "payment_invoice_items_counterpartyUuid_idx" ON "payment_invoice_items"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "payment_invoice_items_updatedAt_idx" ON "payment_invoice_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfer_items_uuid_key" ON "inventory_transfer_items"("uuid");

-- CreateIndex
CREATE INDEX "inventory_transfer_items_inventoryTransferUuid_idx" ON "inventory_transfer_items"("inventoryTransferUuid");

-- CreateIndex
CREATE INDEX "inventory_transfer_items_productUuid_idx" ON "inventory_transfer_items"("productUuid");

-- CreateIndex
CREATE INDEX "inventory_transfer_items_unitOfMeasureUuid_idx" ON "inventory_transfer_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "inventory_transfer_items_updatedAt_idx" ON "inventory_transfer_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "employees_uuid_key" ON "employees"("uuid");

-- CreateIndex
CREATE INDEX "employees_organizationUuid_idx" ON "employees"("organizationUuid");

-- CreateIndex
CREATE INDEX "employees_updatedAt_idx" ON "employees"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "positions_uuid_key" ON "positions"("uuid");

-- CreateIndex
CREATE INDEX "positions_organizationUuid_idx" ON "positions"("organizationUuid");

-- CreateIndex
CREATE INDEX "positions_updatedAt_idx" ON "positions"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "employee_history_uuid_key" ON "employee_history"("uuid");

-- CreateIndex
CREATE INDEX "employee_history_employeeUuid_idx" ON "employee_history"("employeeUuid");

-- CreateIndex
CREATE INDEX "employee_history_positionUuid_idx" ON "employee_history"("positionUuid");

-- CreateIndex
CREATE INDEX "employee_history_organizationUuid_idx" ON "employee_history"("organizationUuid");

-- CreateIndex
CREATE INDEX "employee_history_updatedAt_idx" ON "employee_history"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "access_rights_uuid_key" ON "access_rights"("uuid");

-- CreateIndex
CREATE INDEX "access_rights_userUuid_idx" ON "access_rights"("userUuid");

-- CreateIndex
CREATE INDEX "access_rights_organizationUuid_idx" ON "access_rights"("organizationUuid");

-- CreateIndex
CREATE INDEX "access_rights_updatedAt_idx" ON "access_rights"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "access_rights_userUuid_organizationUuid_modelName_key" ON "access_rights"("userUuid", "organizationUuid", "modelName");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_uuid_key" ON "currencies"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- CreateIndex
CREATE INDEX "currencies_updatedAt_idx" ON "currencies"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_calculations_uuid_key" ON "payroll_calculations"("uuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_employeeUuid_idx" ON "payroll_calculations"("employeeUuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_organizationUuid_idx" ON "payroll_calculations"("organizationUuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_positionUuid_idx" ON "payroll_calculations"("positionUuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_authorUuid_idx" ON "payroll_calculations"("authorUuid");

-- CreateIndex
CREATE INDEX "payroll_calculations_date_idx" ON "payroll_calculations"("date");

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
CREATE INDEX "payroll_payments_authorUuid_idx" ON "payroll_payments"("authorUuid");

-- CreateIndex
CREATE INDEX "payroll_payments_date_idx" ON "payroll_payments"("date");

-- CreateIndex
CREATE INDEX "payroll_payments_period_idx" ON "payroll_payments"("period");

-- CreateIndex
CREATE INDEX "payroll_payments_updatedAt_idx" ON "payroll_payments"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_uuid_key" ON "units_of_measure"("uuid");

-- CreateIndex
CREATE INDEX "units_of_measure_updatedAt_idx" ON "units_of_measure"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "taxes_uuid_key" ON "taxes"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "taxes_code_key" ON "taxes"("code");

-- CreateIndex
CREATE INDEX "taxes_updatedAt_idx" ON "taxes"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "organization_accounting_settings_uuid_key" ON "organization_accounting_settings"("uuid");

-- CreateIndex
CREATE INDEX "organization_accounting_settings_organizationUuid_idx" ON "organization_accounting_settings"("organizationUuid");

-- CreateIndex
CREATE INDEX "organization_accounting_settings_startDate_idx" ON "organization_accounting_settings"("startDate");

-- CreateIndex
CREATE INDEX "organization_accounting_settings_updatedAt_idx" ON "organization_accounting_settings"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_uuid_key" ON "sale_returns"("uuid");

-- CreateIndex
CREATE INDEX "sale_returns_organizationUuid_idx" ON "sale_returns"("organizationUuid");

-- CreateIndex
CREATE INDEX "sale_returns_counterpartyUuid_idx" ON "sale_returns"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "sale_returns_contractUuid_idx" ON "sale_returns"("contractUuid");

-- CreateIndex
CREATE INDEX "sale_returns_warehouseUuid_idx" ON "sale_returns"("warehouseUuid");

-- CreateIndex
CREATE INDEX "sale_returns_authorUuid_idx" ON "sale_returns"("authorUuid");

-- CreateIndex
CREATE INDEX "sale_returns_date_idx" ON "sale_returns"("date");

-- CreateIndex
CREATE INDEX "sale_returns_updatedAt_idx" ON "sale_returns"("updatedAt");

-- CreateIndex
CREATE INDEX "sale_returns_basisDocumentUuid_idx" ON "sale_returns"("basisDocumentUuid");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_items_uuid_key" ON "sale_return_items"("uuid");

-- CreateIndex
CREATE INDEX "sale_return_items_saleReturnUuid_idx" ON "sale_return_items"("saleReturnUuid");

-- CreateIndex
CREATE INDEX "sale_return_items_productUuid_idx" ON "sale_return_items"("productUuid");

-- CreateIndex
CREATE INDEX "sale_return_items_unitOfMeasureUuid_idx" ON "sale_return_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "sale_return_items_date_idx" ON "sale_return_items"("date");

-- CreateIndex
CREATE INDEX "sale_return_items_posted_idx" ON "sale_return_items"("posted");

-- CreateIndex
CREATE INDEX "sale_return_items_organizationUuid_idx" ON "sale_return_items"("organizationUuid");

-- CreateIndex
CREATE INDEX "sale_return_items_counterpartyUuid_idx" ON "sale_return_items"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "sale_return_items_updatedAt_idx" ON "sale_return_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_uuid_key" ON "purchase_returns"("uuid");

-- CreateIndex
CREATE INDEX "purchase_returns_organizationUuid_idx" ON "purchase_returns"("organizationUuid");

-- CreateIndex
CREATE INDEX "purchase_returns_counterpartyUuid_idx" ON "purchase_returns"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "purchase_returns_contractUuid_idx" ON "purchase_returns"("contractUuid");

-- CreateIndex
CREATE INDEX "purchase_returns_warehouseUuid_idx" ON "purchase_returns"("warehouseUuid");

-- CreateIndex
CREATE INDEX "purchase_returns_authorUuid_idx" ON "purchase_returns"("authorUuid");

-- CreateIndex
CREATE INDEX "purchase_returns_date_idx" ON "purchase_returns"("date");

-- CreateIndex
CREATE INDEX "purchase_returns_updatedAt_idx" ON "purchase_returns"("updatedAt");

-- CreateIndex
CREATE INDEX "purchase_returns_basisDocumentUuid_idx" ON "purchase_returns"("basisDocumentUuid");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_return_items_uuid_key" ON "purchase_return_items"("uuid");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchaseReturnUuid_idx" ON "purchase_return_items"("purchaseReturnUuid");

-- CreateIndex
CREATE INDEX "purchase_return_items_productUuid_idx" ON "purchase_return_items"("productUuid");

-- CreateIndex
CREATE INDEX "purchase_return_items_unitOfMeasureUuid_idx" ON "purchase_return_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "purchase_return_items_date_idx" ON "purchase_return_items"("date");

-- CreateIndex
CREATE INDEX "purchase_return_items_posted_idx" ON "purchase_return_items"("posted");

-- CreateIndex
CREATE INDEX "purchase_return_items_organizationUuid_idx" ON "purchase_return_items"("organizationUuid");

-- CreateIndex
CREATE INDEX "purchase_return_items_counterpartyUuid_idx" ON "purchase_return_items"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "purchase_return_items_updatedAt_idx" ON "purchase_return_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_uuid_key" ON "purchase_requisitions"("uuid");

-- CreateIndex
CREATE INDEX "purchase_requisitions_organizationUuid_idx" ON "purchase_requisitions"("organizationUuid");

-- CreateIndex
CREATE INDEX "purchase_requisitions_counterpartyUuid_idx" ON "purchase_requisitions"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "purchase_requisitions_contractUuid_idx" ON "purchase_requisitions"("contractUuid");

-- CreateIndex
CREATE INDEX "purchase_requisitions_authorUuid_idx" ON "purchase_requisitions"("authorUuid");

-- CreateIndex
CREATE INDEX "purchase_requisitions_date_idx" ON "purchase_requisitions"("date");

-- CreateIndex
CREATE INDEX "purchase_requisitions_basisDocumentUuid_idx" ON "purchase_requisitions"("basisDocumentUuid");

-- CreateIndex
CREATE INDEX "purchase_requisitions_updatedAt_idx" ON "purchase_requisitions"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_items_uuid_key" ON "purchase_requisition_items"("uuid");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_purchaseRequisitionUuid_idx" ON "purchase_requisition_items"("purchaseRequisitionUuid");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_productUuid_idx" ON "purchase_requisition_items"("productUuid");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_unitOfMeasureUuid_idx" ON "purchase_requisition_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_date_idx" ON "purchase_requisition_items"("date");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_posted_idx" ON "purchase_requisition_items"("posted");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_organizationUuid_idx" ON "purchase_requisition_items"("organizationUuid");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_counterpartyUuid_idx" ON "purchase_requisition_items"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "purchase_requisition_items_updatedAt_idx" ON "purchase_requisition_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_register_uuid_key" ON "product_register"("uuid");

-- CreateIndex
CREATE INDEX "product_register_productUuid_idx" ON "product_register"("productUuid");

-- CreateIndex
CREATE INDEX "product_register_warehouseUuid_idx" ON "product_register"("warehouseUuid");

-- CreateIndex
CREATE INDEX "product_register_organizationUuid_idx" ON "product_register"("organizationUuid");

-- CreateIndex
CREATE INDEX "product_register_documentType_documentUuid_idx" ON "product_register"("documentType", "documentUuid");

-- CreateIndex
CREATE INDEX "product_register_date_idx" ON "product_register"("date");

-- CreateIndex
CREATE UNIQUE INDEX "subkonto_types_uuid_key" ON "subkonto_types"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "subkonto_types_code_key" ON "subkonto_types"("code");

-- CreateIndex
CREATE INDEX "subkonto_types_updatedAt_idx" ON "subkonto_types"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_uuid_key" ON "chart_of_accounts"("uuid");

-- CreateIndex
CREATE INDEX "chart_of_accounts_code_idx" ON "chart_of_accounts"("code");

-- CreateIndex
CREATE INDEX "chart_of_accounts_parentUuid_idx" ON "chart_of_accounts"("parentUuid");

-- CreateIndex
CREATE INDEX "chart_of_accounts_organizationUuid_idx" ON "chart_of_accounts"("organizationUuid");

-- CreateIndex
CREATE INDEX "chart_of_accounts_updatedAt_idx" ON "chart_of_accounts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_organizationUuid_code_key" ON "chart_of_accounts"("organizationUuid", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_uuid_key" ON "accounting_entries"("uuid");

-- CreateIndex
CREATE INDEX "accounting_entries_organizationUuid_idx" ON "accounting_entries"("organizationUuid");

-- CreateIndex
CREATE INDEX "accounting_entries_documentType_documentUuid_idx" ON "accounting_entries"("documentType", "documentUuid");

-- CreateIndex
CREATE INDEX "accounting_entries_date_idx" ON "accounting_entries"("date");

-- CreateIndex
CREATE INDEX "accounting_entries_debitAccountCode_idx" ON "accounting_entries"("debitAccountCode");

-- CreateIndex
CREATE INDEX "accounting_entries_creditAccountCode_idx" ON "accounting_entries"("creditAccountCode");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entry_analytics_uuid_key" ON "accounting_entry_analytics"("uuid");

-- CreateIndex
CREATE INDEX "accounting_entry_analytics_accountingEntryUuid_idx" ON "accounting_entry_analytics"("accountingEntryUuid");

-- CreateIndex
CREATE INDEX "accounting_entry_analytics_subkontoType_objectUuid_idx" ON "accounting_entry_analytics"("subkontoType", "objectUuid");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_offers_uuid_key" ON "commercial_offers"("uuid");

-- CreateIndex
CREATE INDEX "commercial_offers_organizationUuid_idx" ON "commercial_offers"("organizationUuid");

-- CreateIndex
CREATE INDEX "commercial_offers_counterpartyUuid_idx" ON "commercial_offers"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "commercial_offers_contractUuid_idx" ON "commercial_offers"("contractUuid");

-- CreateIndex
CREATE INDEX "commercial_offers_authorUuid_idx" ON "commercial_offers"("authorUuid");

-- CreateIndex
CREATE INDEX "commercial_offers_date_idx" ON "commercial_offers"("date");

-- CreateIndex
CREATE INDEX "commercial_offers_basisDocumentUuid_idx" ON "commercial_offers"("basisDocumentUuid");

-- CreateIndex
CREATE INDEX "commercial_offers_updatedAt_idx" ON "commercial_offers"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_offer_items_uuid_key" ON "commercial_offer_items"("uuid");

-- CreateIndex
CREATE INDEX "commercial_offer_items_commercialOfferUuid_idx" ON "commercial_offer_items"("commercialOfferUuid");

-- CreateIndex
CREATE INDEX "commercial_offer_items_productUuid_idx" ON "commercial_offer_items"("productUuid");

-- CreateIndex
CREATE INDEX "commercial_offer_items_unitOfMeasureUuid_idx" ON "commercial_offer_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "commercial_offer_items_updatedAt_idx" ON "commercial_offer_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_uuid_key" ON "sales_orders"("uuid");

-- CreateIndex
CREATE INDEX "sales_orders_organizationUuid_idx" ON "sales_orders"("organizationUuid");

-- CreateIndex
CREATE INDEX "sales_orders_counterpartyUuid_idx" ON "sales_orders"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "sales_orders_contractUuid_idx" ON "sales_orders"("contractUuid");

-- CreateIndex
CREATE INDEX "sales_orders_warehouseUuid_idx" ON "sales_orders"("warehouseUuid");

-- CreateIndex
CREATE INDEX "sales_orders_authorUuid_idx" ON "sales_orders"("authorUuid");

-- CreateIndex
CREATE INDEX "sales_orders_date_idx" ON "sales_orders"("date");

-- CreateIndex
CREATE INDEX "sales_orders_basisDocumentUuid_idx" ON "sales_orders"("basisDocumentUuid");

-- CreateIndex
CREATE INDEX "sales_orders_updatedAt_idx" ON "sales_orders"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_items_uuid_key" ON "sales_order_items"("uuid");

-- CreateIndex
CREATE INDEX "sales_order_items_salesOrderUuid_idx" ON "sales_order_items"("salesOrderUuid");

-- CreateIndex
CREATE INDEX "sales_order_items_productUuid_idx" ON "sales_order_items"("productUuid");

-- CreateIndex
CREATE INDEX "sales_order_items_unitOfMeasureUuid_idx" ON "sales_order_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "sales_order_items_updatedAt_idx" ON "sales_order_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_uuid_key" ON "reservations"("uuid");

-- CreateIndex
CREATE INDEX "reservations_organizationUuid_idx" ON "reservations"("organizationUuid");

-- CreateIndex
CREATE INDEX "reservations_counterpartyUuid_idx" ON "reservations"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "reservations_contractUuid_idx" ON "reservations"("contractUuid");

-- CreateIndex
CREATE INDEX "reservations_warehouseUuid_idx" ON "reservations"("warehouseUuid");

-- CreateIndex
CREATE INDEX "reservations_authorUuid_idx" ON "reservations"("authorUuid");

-- CreateIndex
CREATE INDEX "reservations_date_idx" ON "reservations"("date");

-- CreateIndex
CREATE INDEX "reservations_basisDocumentUuid_idx" ON "reservations"("basisDocumentUuid");

-- CreateIndex
CREATE INDEX "reservations_updatedAt_idx" ON "reservations"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_items_uuid_key" ON "reservation_items"("uuid");

-- CreateIndex
CREATE INDEX "reservation_items_reservationUuid_idx" ON "reservation_items"("reservationUuid");

-- CreateIndex
CREATE INDEX "reservation_items_productUuid_idx" ON "reservation_items"("productUuid");

-- CreateIndex
CREATE INDEX "reservation_items_unitOfMeasureUuid_idx" ON "reservation_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "reservation_items_updatedAt_idx" ON "reservation_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_uuid_key" ON "purchase_orders"("uuid");

-- CreateIndex
CREATE INDEX "purchase_orders_organizationUuid_idx" ON "purchase_orders"("organizationUuid");

-- CreateIndex
CREATE INDEX "purchase_orders_counterpartyUuid_idx" ON "purchase_orders"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "purchase_orders_contractUuid_idx" ON "purchase_orders"("contractUuid");

-- CreateIndex
CREATE INDEX "purchase_orders_warehouseUuid_idx" ON "purchase_orders"("warehouseUuid");

-- CreateIndex
CREATE INDEX "purchase_orders_authorUuid_idx" ON "purchase_orders"("authorUuid");

-- CreateIndex
CREATE INDEX "purchase_orders_date_idx" ON "purchase_orders"("date");

-- CreateIndex
CREATE INDEX "purchase_orders_basisDocumentUuid_idx" ON "purchase_orders"("basisDocumentUuid");

-- CreateIndex
CREATE INDEX "purchase_orders_updatedAt_idx" ON "purchase_orders"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_uuid_key" ON "purchase_order_items"("uuid");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchaseOrderUuid_idx" ON "purchase_order_items"("purchaseOrderUuid");

-- CreateIndex
CREATE INDEX "purchase_order_items_productUuid_idx" ON "purchase_order_items"("productUuid");

-- CreateIndex
CREATE INDEX "purchase_order_items_unitOfMeasureUuid_idx" ON "purchase_order_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "purchase_order_items_updatedAt_idx" ON "purchase_order_items"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_uuid_key" ON "bank_statements"("uuid");

-- CreateIndex
CREATE INDEX "bank_statements_organizationUuid_idx" ON "bank_statements"("organizationUuid");

-- CreateIndex
CREATE INDEX "bank_statements_counterpartyUuid_idx" ON "bank_statements"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "bank_statements_contractUuid_idx" ON "bank_statements"("contractUuid");

-- CreateIndex
CREATE INDEX "bank_statements_bankAccountUuid_idx" ON "bank_statements"("bankAccountUuid");

-- CreateIndex
CREATE INDEX "bank_statements_authorUuid_idx" ON "bank_statements"("authorUuid");

-- CreateIndex
CREATE INDEX "bank_statements_date_idx" ON "bank_statements"("date");

-- CreateIndex
CREATE INDEX "bank_statements_basisDocumentUuid_idx" ON "bank_statements"("basisDocumentUuid");

-- CreateIndex
CREATE INDEX "bank_statements_updatedAt_idx" ON "bank_statements"("updatedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_defaults" ADD CONSTRAINT "user_permission_defaults_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_defaults" ADD CONSTRAINT "user_permission_defaults_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_currencyUuid_fkey" FOREIGN KEY ("currencyUuid") REFERENCES "currencies"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_history" ADD CONSTRAINT "activity_history_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_curatorUuid_fkey" FOREIGN KEY ("curatorUuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_executorUuid_fkey" FOREIGN KEY ("executorUuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashboxes" ADD CONSTRAINT "cashboxes_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoices" ADD CONSTRAINT "outgoing_invoices_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoices" ADD CONSTRAINT "outgoing_invoices_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoices" ADD CONSTRAINT "outgoing_invoices_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoices" ADD CONSTRAINT "outgoing_invoices_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoices" ADD CONSTRAINT "incoming_invoices_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoices" ADD CONSTRAINT "incoming_invoices_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoices" ADD CONSTRAINT "incoming_invoices_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoices" ADD CONSTRAINT "incoming_invoices_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoices" ADD CONSTRAINT "payment_invoices_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_fromWarehouseUuid_fkey" FOREIGN KEY ("fromWarehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_toWarehouseUuid_fkey" FOREIGN KEY ("toWarehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_receipt_orders" ADD CONSTRAINT "cash_receipt_orders_cashboxUuid_fkey" FOREIGN KEY ("cashboxUuid") REFERENCES "cashboxes"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_receipt_orders" ADD CONSTRAINT "cash_receipt_orders_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_receipt_orders" ADD CONSTRAINT "cash_receipt_orders_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_receipt_orders" ADD CONSTRAINT "cash_receipt_orders_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_receipt_orders" ADD CONSTRAINT "cash_receipt_orders_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_expense_orders" ADD CONSTRAINT "cash_expense_orders_cashboxUuid_fkey" FOREIGN KEY ("cashboxUuid") REFERENCES "cashboxes"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_expense_orders" ADD CONSTRAINT "cash_expense_orders_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_expense_orders" ADD CONSTRAINT "cash_expense_orders_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_expense_orders" ADD CONSTRAINT "cash_expense_orders_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_expense_orders" ADD CONSTRAINT "cash_expense_orders_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandUuid_fkey" FOREIGN KEY ("brandUuid") REFERENCES "brands"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleUuid_fkey" FOREIGN KEY ("saleUuid") REFERENCES "sales"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchaseUuid_fkey" FOREIGN KEY ("purchaseUuid") REFERENCES "purchases"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoice_items" ADD CONSTRAINT "outgoing_invoice_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoice_items" ADD CONSTRAINT "outgoing_invoice_items_outgoingInvoiceUuid_fkey" FOREIGN KEY ("outgoingInvoiceUuid") REFERENCES "outgoing_invoices"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_invoice_items" ADD CONSTRAINT "outgoing_invoice_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoice_items" ADD CONSTRAINT "incoming_invoice_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoice_items" ADD CONSTRAINT "incoming_invoice_items_incomingInvoiceUuid_fkey" FOREIGN KEY ("incomingInvoiceUuid") REFERENCES "incoming_invoices"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_invoice_items" ADD CONSTRAINT "incoming_invoice_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoice_items" ADD CONSTRAINT "payment_invoice_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoice_items" ADD CONSTRAINT "payment_invoice_items_paymentInvoiceUuid_fkey" FOREIGN KEY ("paymentInvoiceUuid") REFERENCES "payment_invoices"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_invoice_items" ADD CONSTRAINT "payment_invoice_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer_items" ADD CONSTRAINT "inventory_transfer_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer_items" ADD CONSTRAINT "inventory_transfer_items_inventoryTransferUuid_fkey" FOREIGN KEY ("inventoryTransferUuid") REFERENCES "inventory_transfers"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer_items" ADD CONSTRAINT "inventory_transfer_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_positionUuid_fkey" FOREIGN KEY ("positionUuid") REFERENCES "positions"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_rights" ADD CONSTRAINT "access_rights_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_rights" ADD CONSTRAINT "access_rights_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculations" ADD CONSTRAINT "payroll_calculations_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculations" ADD CONSTRAINT "payroll_calculations_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculations" ADD CONSTRAINT "payroll_calculations_positionUuid_fkey" FOREIGN KEY ("positionUuid") REFERENCES "positions"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_calculations" ADD CONSTRAINT "payroll_calculations_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_accounting_settings" ADD CONSTRAINT "organization_accounting_settings_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_saleReturnUuid_fkey" FOREIGN KEY ("saleReturnUuid") REFERENCES "sale_returns"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseReturnUuid_fkey" FOREIGN KEY ("purchaseReturnUuid") REFERENCES "purchase_returns"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_purchaseRequisitionUuid_fkey" FOREIGN KEY ("purchaseRequisitionUuid") REFERENCES "purchase_requisitions"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_register" ADD CONSTRAINT "product_register_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_register" ADD CONSTRAINT "product_register_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_register" ADD CONSTRAINT "product_register_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_register" ADD CONSTRAINT "product_register_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parentUuid_fkey" FOREIGN KEY ("parentUuid") REFERENCES "chart_of_accounts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_entry_analytics" ADD CONSTRAINT "accounting_entry_analytics_accountingEntryUuid_fkey" FOREIGN KEY ("accountingEntryUuid") REFERENCES "accounting_entries"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_items" ADD CONSTRAINT "commercial_offer_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_items" ADD CONSTRAINT "commercial_offer_items_commercialOfferUuid_fkey" FOREIGN KEY ("commercialOfferUuid") REFERENCES "commercial_offers"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_items" ADD CONSTRAINT "commercial_offer_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_salesOrderUuid_fkey" FOREIGN KEY ("salesOrderUuid") REFERENCES "sales_orders"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservationUuid_fkey" FOREIGN KEY ("reservationUuid") REFERENCES "reservations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderUuid_fkey" FOREIGN KEY ("purchaseOrderUuid") REFERENCES "purchase_orders"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bankAccountUuid_fkey" FOREIGN KEY ("bankAccountUuid") REFERENCES "bank_accounts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partial unique index: уникальность кода глобальных счетов (organizationUuid IS NULL).
-- Prisma не умеет выражать WHERE-индексы в schema.prisma, поэтому он живёт только в этой миграции.
CREATE UNIQUE INDEX "chart_of_accounts_global_code_key" ON "chart_of_accounts" USING btree ("code") WHERE (("organizationUuid" IS NULL) AND ("deletedAt" IS NULL));
