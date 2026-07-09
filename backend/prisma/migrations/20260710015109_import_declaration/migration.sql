-- CreateTable
CREATE TABLE "import_declarations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declarationNumber" TEXT,
    "declarationDate" TIMESTAMP(3),
    "countryCode" TEXT,
    "comment" TEXT,
    "amount" DECIMAL(18,2),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "warehouseUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "import_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_declaration_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "positionNumber" TEXT,
    "unitOfMeasureUuid" TEXT,
    "productUuid" TEXT,
    "importDeclarationUuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "sourceRowId" TEXT,

    CONSTRAINT "import_declaration_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_declarations_uuid_key" ON "import_declarations"("uuid");

-- CreateIndex
CREATE INDEX "import_declarations_organizationUuid_idx" ON "import_declarations"("organizationUuid");

-- CreateIndex
CREATE INDEX "import_declarations_counterpartyUuid_idx" ON "import_declarations"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "import_declarations_warehouseUuid_idx" ON "import_declarations"("warehouseUuid");

-- CreateIndex
CREATE INDEX "import_declarations_date_idx" ON "import_declarations"("date");

-- CreateIndex
CREATE INDEX "import_declarations_updatedAt_idx" ON "import_declarations"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_declaration_items_uuid_key" ON "import_declaration_items"("uuid");

-- CreateIndex
CREATE INDEX "import_declaration_items_importDeclarationUuid_idx" ON "import_declaration_items"("importDeclarationUuid");

-- CreateIndex
CREATE INDEX "import_declaration_items_productUuid_idx" ON "import_declaration_items"("productUuid");

-- CreateIndex
CREATE INDEX "import_declaration_items_sourceRowId_idx" ON "import_declaration_items"("sourceRowId");

-- AddForeignKey
ALTER TABLE "import_declarations" ADD CONSTRAINT "import_declarations_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_declarations" ADD CONSTRAINT "import_declarations_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_declarations" ADD CONSTRAINT "import_declarations_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_declarations" ADD CONSTRAINT "import_declarations_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_declaration_items" ADD CONSTRAINT "import_declaration_items_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_declaration_items" ADD CONSTRAINT "import_declaration_items_importDeclarationUuid_fkey" FOREIGN KEY ("importDeclarationUuid") REFERENCES "import_declarations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_declaration_items" ADD CONSTRAINT "import_declaration_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

