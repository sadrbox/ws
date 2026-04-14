-- CreateIndex
CREATE INDEX "purchases_contractUuid_idx" ON "purchases"("contractUuid");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
