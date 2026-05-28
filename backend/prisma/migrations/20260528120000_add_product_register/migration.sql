-- Регистр накопления «Товары» (движения приход/расход проведённых документов)
CREATE TABLE IF NOT EXISTS "product_register" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "product_register_uuid_key" ON "product_register"("uuid");
CREATE INDEX IF NOT EXISTS "product_register_productUuid_idx" ON "product_register"("productUuid");
CREATE INDEX IF NOT EXISTS "product_register_warehouseUuid_idx" ON "product_register"("warehouseUuid");
CREATE INDEX IF NOT EXISTS "product_register_organizationUuid_idx" ON "product_register"("organizationUuid");
CREATE INDEX IF NOT EXISTS "product_register_documentType_documentUuid_idx" ON "product_register"("documentType", "documentUuid");
CREATE INDEX IF NOT EXISTS "product_register_date_idx" ON "product_register"("date");

DO $$ BEGIN
    ALTER TABLE "product_register" ADD CONSTRAINT "product_register_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "product_register" ADD CONSTRAINT "product_register_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "product_register" ADD CONSTRAINT "product_register_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "product_register" ADD CONSTRAINT "product_register_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
