-- AlterTable
ALTER TABLE "sales"     ADD COLUMN "priceTypeUuid" TEXT;
ALTER TABLE "purchases" ADD COLUMN "priceTypeUuid" TEXT;

-- CreateIndex
CREATE INDEX "sales_priceTypeUuid_idx"     ON "sales"("priceTypeUuid");
CREATE INDEX "purchases_priceTypeUuid_idx" ON "purchases"("priceTypeUuid");

-- AddForeignKey
ALTER TABLE "sales"     ADD CONSTRAINT "sales_priceTypeUuid_fkey"     FOREIGN KEY ("priceTypeUuid") REFERENCES "price_types"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_priceTypeUuid_fkey" FOREIGN KEY ("priceTypeUuid") REFERENCES "price_types"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
