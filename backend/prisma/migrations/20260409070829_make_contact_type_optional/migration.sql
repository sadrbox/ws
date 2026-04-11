-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_contactTypeUuid_fkey";

-- AlterTable
ALTER TABLE "contacts" ALTER COLUMN "value" SET DEFAULT '',
ALTER COLUMN "contactTypeUuid" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contactTypeUuid_fkey" FOREIGN KEY ("contactTypeUuid") REFERENCES "contact_types"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
