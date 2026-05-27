-- Remove isPrimary from warehouses and cashboxes

ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "is_primary";
ALTER TABLE "cashboxes" DROP COLUMN IF EXISTS "is_primary";

DROP INDEX IF EXISTS "warehouses_organization_uuid_is_primary_idx";
DROP INDEX IF EXISTS "cashboxes_organization_uuid_is_primary_idx";
