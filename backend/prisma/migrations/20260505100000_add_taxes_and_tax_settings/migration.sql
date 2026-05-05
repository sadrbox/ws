-- CreateTable
CREATE TABLE "taxes" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "code" TEXT,
    "rate" DECIMAL(5,2),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_settings" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "taxUuid" TEXT NOT NULL,
    "rate" DECIMAL(5,2),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "taxes_uuid_key" ON "taxes"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "taxes_code_key" ON "taxes"("code");

-- CreateIndex
CREATE INDEX "taxes_updatedAt_idx" ON "taxes"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tax_settings_uuid_key" ON "tax_settings"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "tax_settings_taxUuid_key" ON "tax_settings"("taxUuid");

-- CreateIndex
CREATE INDEX "tax_settings_updatedAt_idx" ON "tax_settings"("updatedAt");

-- CreateIndex
CREATE INDEX "tax_settings_taxUuid_idx" ON "tax_settings"("taxUuid");

-- AddForeignKey
ALTER TABLE "tax_settings" ADD CONSTRAINT "tax_settings_taxUuid_fkey" FOREIGN KEY ("taxUuid") REFERENCES "taxes"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
