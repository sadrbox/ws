-- AlterTable
ALTER TABLE "incoming_invoices" ADD COLUMN     "amountWithoutVat" DECIMAL(18,2),
ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "posted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "amount" DECIMAL(18,2),
ADD COLUMN     "posted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "outgoing_invoices" ADD COLUMN     "amountWithoutVat" DECIMAL(18,2),
ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "posted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "payment_invoices" ADD COLUMN     "amountWithoutVat" DECIMAL(18,2),
ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "posted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "amountWithoutVat" DECIMAL(18,2),
ADD COLUMN     "discountAmount" DECIMAL(18,2),
ADD COLUMN     "posted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatAmount" DECIMAL(18,2),
ADD COLUMN     "warehouseUuid" TEXT;

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
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "purchaseUuid" TEXT NOT NULL,
    "taxes" JSONB,
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
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "outgoingInvoiceUuid" TEXT NOT NULL,
    "taxes" JSONB,
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
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "incomingInvoiceUuid" TEXT NOT NULL,
    "taxes" JSONB,
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
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "paymentInvoiceUuid" TEXT NOT NULL,
    "taxes" JSONB,
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

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_uuid_key" ON "purchase_items"("uuid");

-- CreateIndex
CREATE INDEX "purchase_items_purchaseUuid_idx" ON "purchase_items"("purchaseUuid");

-- CreateIndex
CREATE INDEX "purchase_items_productUuid_idx" ON "purchase_items"("productUuid");

-- CreateIndex
CREATE INDEX "purchase_items_unitOfMeasureUuid_idx" ON "purchase_items"("unitOfMeasureUuid");

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
CREATE INDEX "purchases_warehouseUuid_idx" ON "purchases"("warehouseUuid");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

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

