-- CreateTable sale_returns (mirrors sales)
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
    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sale_returns_uuid_key" ON "sale_returns"("uuid");
CREATE INDEX "sale_returns_organizationUuid_idx" ON "sale_returns"("organizationUuid");
CREATE INDEX "sale_returns_counterpartyUuid_idx" ON "sale_returns"("counterpartyUuid");
CREATE INDEX "sale_returns_contractUuid_idx" ON "sale_returns"("contractUuid");
CREATE INDEX "sale_returns_warehouseUuid_idx" ON "sale_returns"("warehouseUuid");
CREATE INDEX "sale_returns_authorUuid_idx" ON "sale_returns"("authorUuid");
CREATE INDEX "sale_returns_date_idx" ON "sale_returns"("date");
CREATE INDEX "sale_returns_updatedAt_idx" ON "sale_returns"("updatedAt");
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable sale_return_items (mirrors sale_items)
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
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "saleReturnUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sale_return_items_uuid_key" ON "sale_return_items"("uuid");
CREATE INDEX "sale_return_items_saleReturnUuid_idx" ON "sale_return_items"("saleReturnUuid");
CREATE INDEX "sale_return_items_productUuid_idx" ON "sale_return_items"("productUuid");
CREATE INDEX "sale_return_items_unitOfMeasureUuid_idx" ON "sale_return_items"("unitOfMeasureUuid");
CREATE INDEX "sale_return_items_updatedAt_idx" ON "sale_return_items"("updatedAt");
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_saleReturnUuid_fkey" FOREIGN KEY ("saleReturnUuid") REFERENCES "sale_returns"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable purchase_returns (mirrors purchases)
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
    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_returns_uuid_key" ON "purchase_returns"("uuid");
CREATE INDEX "purchase_returns_organizationUuid_idx" ON "purchase_returns"("organizationUuid");
CREATE INDEX "purchase_returns_counterpartyUuid_idx" ON "purchase_returns"("counterpartyUuid");
CREATE INDEX "purchase_returns_contractUuid_idx" ON "purchase_returns"("contractUuid");
CREATE INDEX "purchase_returns_warehouseUuid_idx" ON "purchase_returns"("warehouseUuid");
CREATE INDEX "purchase_returns_authorUuid_idx" ON "purchase_returns"("authorUuid");
CREATE INDEX "purchase_returns_date_idx" ON "purchase_returns"("date");
CREATE INDEX "purchase_returns_updatedAt_idx" ON "purchase_returns"("updatedAt");
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable purchase_return_items (mirrors purchase_items)
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
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "purchaseReturnUuid" TEXT NOT NULL,
    "taxes" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_return_items_uuid_key" ON "purchase_return_items"("uuid");
CREATE INDEX "purchase_return_items_purchaseReturnUuid_idx" ON "purchase_return_items"("purchaseReturnUuid");
CREATE INDEX "purchase_return_items_productUuid_idx" ON "purchase_return_items"("productUuid");
CREATE INDEX "purchase_return_items_unitOfMeasureUuid_idx" ON "purchase_return_items"("unitOfMeasureUuid");
CREATE INDEX "purchase_return_items_updatedAt_idx" ON "purchase_return_items"("updatedAt");
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseReturnUuid_fkey" FOREIGN KEY ("purchaseReturnUuid") REFERENCES "purchase_returns"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
