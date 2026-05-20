-- Migration: replace ContactType FK relation with Prisma enum column
-- ContactType справочник заменяется статическим enum на уровне БД.

-- 1. Create enum type
CREATE TYPE "ContactType" AS ENUM (
    'email', 'telephone', 'address', 'whatsapp',
    'telegram', 'instagram', 'facebook', 'website', 'fax', 'other'
);

-- 2. Add new enum column
ALTER TABLE "contacts" ADD COLUMN "contactType" "ContactType";

-- 3. Migrate existing data: map Russian shortName values to enum
UPDATE "contacts" c
SET "contactType" = (
    SELECT CASE ct."shortName"
        WHEN 'Электронный адрес' THEN 'email'::"ContactType"
        WHEN 'Email'             THEN 'email'::"ContactType"
        WHEN 'email'             THEN 'email'::"ContactType"
        WHEN 'Телефон'           THEN 'telephone'::"ContactType"
        WHEN 'Мобильный'         THEN 'telephone'::"ContactType"
        WHEN 'telephone'         THEN 'telephone'::"ContactType"
        WHEN 'Адрес'             THEN 'address'::"ContactType"
        WHEN 'address'           THEN 'address'::"ContactType"
        WHEN 'WhatsApp'          THEN 'whatsapp'::"ContactType"
        WHEN 'whatsapp'          THEN 'whatsapp'::"ContactType"
        WHEN 'Telegram'          THEN 'telegram'::"ContactType"
        WHEN 'telegram'          THEN 'telegram'::"ContactType"
        WHEN 'Instagram'         THEN 'instagram'::"ContactType"
        WHEN 'Facebook'          THEN 'facebook'::"ContactType"
        WHEN 'Веб-сайт'          THEN 'website'::"ContactType"
        WHEN 'website'           THEN 'website'::"ContactType"
        WHEN 'Факс'              THEN 'fax'::"ContactType"
        WHEN 'fax'               THEN 'fax'::"ContactType"
        ELSE NULL
    END
    FROM "contact_types" ct
    WHERE ct."uuid" = c."contactTypeUuid"
)
WHERE c."contactTypeUuid" IS NOT NULL;

-- 4. Drop composite index on old FK column
DROP INDEX IF EXISTS "contacts_contactTypeUuid_ownerType_ownerUuid_isPrimary_idx";

-- 5. Drop simple index on old FK column
DROP INDEX IF EXISTS "contacts_contactTypeUuid_idx";

-- 6. Drop FK constraint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_contactTypeUuid_fkey";

-- 7. Drop old FK column
ALTER TABLE "contacts" DROP COLUMN "contactTypeUuid";

-- 8. Create new composite index on enum column
CREATE INDEX "contacts_contactType_ownerType_ownerUuid_isPrimary_idx"
    ON "contacts"("contactType", "ownerType", "ownerUuid", "isPrimary");

-- 9. Drop contact_types table (no longer referenced)
DROP TABLE IF EXISTS "contact_types";
