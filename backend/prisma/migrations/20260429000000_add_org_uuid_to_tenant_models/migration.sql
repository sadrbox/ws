-- AddColumn organizationUuid to counterparties
ALTER TABLE "counterparties" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_organizationUuid_fkey"
  FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "counterparties_organizationUuid_idx" ON "counterparties"("organizationUuid");

-- AddColumn organizationUuid to brands
ALTER TABLE "brands" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "brands" ADD CONSTRAINT "brands_organizationUuid_fkey"
  FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "brands_organizationUuid_idx" ON "brands"("organizationUuid");

-- AddColumn organizationUuid to products
ALTER TABLE "products" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "products" ADD CONSTRAINT "products_organizationUuid_fkey"
  FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "products_organizationUuid_idx" ON "products"("organizationUuid");

-- AddColumn organizationUuid to positions
ALTER TABLE "positions" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "positions" ADD CONSTRAINT "positions_organizationUuid_fkey"
  FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "positions_organizationUuid_idx" ON "positions"("organizationUuid");

-- AddColumn organizationUuid to contacts
ALTER TABLE "contacts" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationUuid_fkey"
  FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "contacts_organizationUuid_idx" ON "contacts"("organizationUuid");

-- AddColumn organizationUuid to contact_persons
ALTER TABLE "contact_persons" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_organizationUuid_fkey"
  FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "contact_persons_organizationUuid_idx" ON "contact_persons"("organizationUuid");

-- AddColumn organizationUuid to bank_accounts
ALTER TABLE "bank_accounts" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organizationUuid_fkey"
  FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "bank_accounts_organizationUuid_idx" ON "bank_accounts"("organizationUuid");
