/*
  Warnings:


  - You are about to drop the column `unitOfMeasure` on the `sale_items` table. All the data in the column will be lost.

*/


-- AlterTable
ALTER TABLE "products" ADD COLUMN     "unitOfMeasureUuid" TEXT;

-- AlterTable

-- AlterTable
ALTER TABLE "sale_items" DROP COLUMN "unitOfMeasure",
ADD COLUMN     "unitOfMeasureUuid" TEXT,
ADD COLUMN     "vatRateUuid" TEXT;

-- AlterTable

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "code" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_rates" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vat_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_uuid_key" ON "units_of_measure"("uuid");

-- CreateIndex
CREATE INDEX "units_of_measure_updatedAt_idx" ON "units_of_measure"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vat_rates_uuid_key" ON "vat_rates"("uuid");

-- CreateIndex
CREATE INDEX "vat_rates_updatedAt_idx" ON "vat_rates"("updatedAt");

-- CreateIndex
CREATE INDEX "products_unitOfMeasureUuid_idx" ON "products"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "sale_items_unitOfMeasureUuid_idx" ON "sale_items"("unitOfMeasureUuid");

-- CreateIndex
CREATE INDEX "sale_items_vatRateUuid_idx" ON "sale_items"("vatRateUuid");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unitOfMeasureUuid_fkey" FOREIGN KEY ("unitOfMeasureUuid") REFERENCES "units_of_measure"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_vatRateUuid_fkey" FOREIGN KEY ("vatRateUuid") REFERENCES "vat_rates"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
