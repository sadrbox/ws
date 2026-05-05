-- Redesign tax_settings as historical journal: per-organization, taxUuids[] array.
-- Migrate existing rows: each old row (taxUuid, rate) → bulk into a single global record
-- with organizationUuid=NULL containing the union of all enabled tax UUIDs.

-- 1. Save existing enabled tax UUIDs into a temp table
CREATE TEMP TABLE _legacy_tax_settings AS
SELECT "taxUuid" FROM "tax_settings" WHERE "deletedAt" IS NULL AND "taxUuid" IS NOT NULL;

-- 2. Drop legacy structure
DROP INDEX IF EXISTS "tax_settings_taxUuid_key";
DROP INDEX IF EXISTS "tax_settings_taxUuid_idx";
ALTER TABLE "tax_settings" DROP COLUMN IF EXISTS "taxUuid";
ALTER TABLE "tax_settings" DROP COLUMN IF EXISTS "rate";

-- 3. Add new columns
ALTER TABLE "tax_settings" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "tax_settings" ADD COLUMN "taxUuids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 4. Drop all legacy rows (we will reseed with one aggregated row)
DELETE FROM "tax_settings";

-- 5. Reseed: one global row with all previously enabled taxes
INSERT INTO "tax_settings" ("uuid", "organizationUuid", "taxUuids", "updatedAt")
SELECT gen_random_uuid()::text, NULL, COALESCE(array_agg("taxUuid"), ARRAY[]::TEXT[]), NOW()
FROM _legacy_tax_settings
HAVING count(*) > 0;

-- 6. FK + indexes
ALTER TABLE "tax_settings"
  ADD CONSTRAINT "tax_settings_organizationUuid_fkey"
  FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tax_settings_organizationUuid_idx" ON "tax_settings"("organizationUuid");

-- 7. SaleItem.taxes JSON column
ALTER TABLE "sale_items" ADD COLUMN "taxes" JSONB;

DROP TABLE _legacy_tax_settings;
