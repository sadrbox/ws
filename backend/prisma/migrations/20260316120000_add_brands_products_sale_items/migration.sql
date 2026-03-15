-- CreateTable: brands
CREATE TABLE IF NOT EXISTS "brands" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "shortName" TEXT NOT NULL,
  CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "brands_uuid_key" ON "brands"("uuid");

-- CreateTable: products
CREATE TABLE IF NOT EXISTS "products" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "shortName" TEXT NOT NULL,
  "sku" TEXT,
  "brandUuid" TEXT,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "products_uuid_key" ON "products"("uuid");

CREATE INDEX IF NOT EXISTS "products_brandUuid_idx" ON "products"("brandUuid");

-- CreateTable: sale_items
CREATE TABLE IF NOT EXISTS "sale_items" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL DEFAULT 0,
  "quantity" DECIMAL(18, 4) NOT NULL DEFAULT 0,
  "price" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "productUuid" TEXT,
  "saleUuid" TEXT NOT NULL,
  CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sale_items_uuid_key" ON "sale_items"("uuid");

CREATE INDEX IF NOT EXISTS "sale_items_saleUuid_idx" ON "sale_items"("saleUuid");

CREATE INDEX IF NOT EXISTS "sale_items_productUuid_idx" ON "sale_items"("productUuid");

-- AddForeignKey
ALTER TABLE
  "products"
ADD
  CONSTRAINT "products_brandUuid_fkey" FOREIGN KEY ("brandUuid") REFERENCES "brands"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE
  "sale_items"
ADD
  CONSTRAINT "sale_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE
SET
  NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE
  "sale_items"
ADD
  CONSTRAINT "sale_items_saleUuid_fkey" FOREIGN KEY ("saleUuid") REFERENCES "sales"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;