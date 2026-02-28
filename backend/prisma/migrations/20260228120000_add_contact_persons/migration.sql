-- CreateTable
CREATE TABLE IF NOT EXISTS "contact_persons" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,
    "fullName" VARCHAR(255),
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "ownerName" TEXT,
    CONSTRAINT "contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contact_persons_uuid_key" ON "contact_persons"("uuid");
CREATE INDEX IF NOT EXISTS "contact_persons_organizationUuid_idx" ON "contact_persons"("organizationUuid");
CREATE INDEX IF NOT EXISTS "contact_persons_counterpartyUuid_idx" ON "contact_persons"("counterpartyUuid");

-- AddForeignKey
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add contactPersonUuid to contacts
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "contactPersonUuid" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_contactPersonUuid_idx" ON "contacts"("contactPersonUuid");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contactPersonUuid_fkey" FOREIGN KEY ("contactPersonUuid") REFERENCES "contact_persons"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
