-- Rename shortName → name in all reference/catalog tables
ALTER TABLE "organizations"    RENAME COLUMN "shortName" TO "name";
ALTER TABLE "counterparties"   RENAME COLUMN "shortName" TO "name";
ALTER TABLE "contracts"        RENAME COLUMN "shortName" TO "name";
ALTER TABLE "bank_accounts"    RENAME COLUMN "shortName" TO "name";
ALTER TABLE "todos"            RENAME COLUMN "shortName" TO "name";
ALTER TABLE "warehouses"       RENAME COLUMN "shortName" TO "name";
ALTER TABLE "cashboxes"        RENAME COLUMN "shortName" TO "name";
ALTER TABLE "scheduled_tasks"  RENAME COLUMN "shortName" TO "name";
ALTER TABLE "brands"           RENAME COLUMN "shortName" TO "name";
ALTER TABLE "products"         RENAME COLUMN "shortName" TO "name";
ALTER TABLE "positions"        RENAME COLUMN "shortName" TO "name";
ALTER TABLE "currencies"       RENAME COLUMN "shortName" TO "name";
ALTER TABLE "units_of_measure" RENAME COLUMN "shortName" TO "name";
ALTER TABLE "taxes"            RENAME COLUMN "shortName" TO "name";
