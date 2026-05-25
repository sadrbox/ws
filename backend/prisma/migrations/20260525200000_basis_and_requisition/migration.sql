-- Basis fields on 5 existing tables
ALTER TABLE "sales" ADD COLUMN "basisDocumentType" TEXT;
ALTER TABLE "sales" ADD COLUMN "basisDocumentUuid" TEXT;
ALTER TABLE "sales" ADD COLUMN "basisDocumentLabel" TEXT;
CREATE INDEX "sales_basisDocumentUuid_idx" ON "sales"("basisDocumentUuid");

ALTER TABLE "outgoing_invoices" ADD COLUMN "basisDocumentType" TEXT;
ALTER TABLE "outgoing_invoices" ADD COLUMN "basisDocumentUuid" TEXT;
ALTER TABLE "outgoing_invoices" ADD COLUMN "basisDocumentLabel" TEXT;
CREATE INDEX "outgoing_invoices_basisDocumentUuid_idx" ON "outgoing_invoices"("basisDocumentUuid");

ALTER TABLE "purchases" ADD COLUMN "basisDocumentType" TEXT;
ALTER TABLE "purchases" ADD COLUMN "basisDocumentUuid" TEXT;
ALTER TABLE "purchases" ADD COLUMN "basisDocumentLabel" TEXT;
CREATE INDEX "purchases_basisDocumentUuid_idx" ON "purchases"("basisDocumentUuid");

ALTER TABLE "sale_returns" ADD COLUMN "basisDocumentType" TEXT;
ALTER TABLE "sale_returns" ADD COLUMN "basisDocumentUuid" TEXT;
ALTER TABLE "sale_returns" ADD COLUMN "basisDocumentLabel" TEXT;
CREATE INDEX "sale_returns_basisDocumentUuid_idx" ON "sale_returns"("basisDocumentUuid");

ALTER TABLE "purchase_returns" ADD COLUMN "basisDocumentType" TEXT;
ALTER TABLE "purchase_returns" ADD COLUMN "basisDocumentUuid" TEXT;
ALTER TABLE "purchase_returns" ADD COLUMN "basisDocumentLabel" TEXT;
CREATE INDEX "purchase_returns_basisDocumentUuid_idx" ON "purchase_returns"("basisDocumentUuid");

-- CreateTable: purchase_requisitions
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_requisitions_uuid_key" ON "purchase_requisitions"("uuid");
CREATE INDEX "purchase_requisitions_organizationUuid_idx" ON "purchase_requisitions"("organizationUuid");
CREATE INDEX "purchase_requisitions_counterpartyUuid_idx" ON "purchase_requisitions"("counterpartyUuid");
CREATE INDEX "purchase_requisitions_contractUuid_idx" ON "purchase_requisitions"("contractUuid");
CREATE INDEX "purchase_requisitions_authorUuid_idx" ON "purchase_requisitions"("authorUuid");
CREATE INDEX "purchase_requisitions_date_idx" ON "purchase_requisitions"("date");
CREATE INDEX "purchase_requisitions_updatedAt_idx" ON "purchase_requisitions"("updatedAt");
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: purchase_requisition_items
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "purchase_requisition_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_requisition_items_uuid_key" ON "purchase_requisition_items"("uuid");
CREATE INDEX "purchase_requisition_items_purchaseRequisitionUuid_idx" ON "purchase_requisition_items"("purchaseRequisitionUuid");
CREATE INDEX "purchase_requisition_items_productUuid_idx" ON "purchase_requisition_items"("productUuid");
CREATE INDEX "purchase_requisition_items_unitOfMeasureUuid_idx" ON "purchase_requisition_items"("unitOfMeasureUuid");
CREATE INDEX "purchase_requisition_items_updatedAt_idx" ON "purchase_requisition_items"("updatedAt");
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_purchaseRequisitionUuid_fkey" FOREIGN KEY ("purchaseRequisitionUuid") REFERENCES "purchase_requisitions"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_requisition_items" ADD CONSTRAINT "purchase_requisition_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
