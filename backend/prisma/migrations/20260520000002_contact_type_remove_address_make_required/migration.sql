-- Migration: remove 'address' from ContactType enum, make contactType NOT NULL

-- 1. Migrate data: address → actual_address, NULL → other
UPDATE "contacts" SET "contactType" = 'actual_address' WHERE "contactType" = 'address';
UPDATE "contacts" SET "contactType" = 'other'           WHERE "contactType" IS NULL;

-- 2. Recreate enum without 'address'
--    PostgreSQL does not support DROP VALUE, so we recreate the type.
CREATE TYPE "ContactType_new" AS ENUM (
    'email', 'telephone', 'legal_address', 'actual_address',
    'whatsapp', 'telegram', 'instagram', 'facebook', 'website', 'fax', 'other'
);

-- 3. Swap column to new type
ALTER TABLE "contacts"
    ALTER COLUMN "contactType" TYPE "ContactType_new"
    USING "contactType"::text::"ContactType_new";

-- 4. Drop old enum, rename new one
DROP TYPE "ContactType";
ALTER TYPE "ContactType_new" RENAME TO "ContactType";

-- 5. Make column NOT NULL
ALTER TABLE "contacts" ALTER COLUMN "contactType" SET NOT NULL;
