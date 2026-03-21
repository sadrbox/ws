-- AlterTable
ALTER TABLE "contact_persons" ADD COLUMN     "comment" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "employeeUuid" TEXT,
ADD COLUMN     "userUuid" TEXT;

-- CreateIndex
CREATE INDEX "contacts_userUuid_idx" ON "contacts"("userUuid");

-- CreateIndex
CREATE INDEX "contacts_employeeUuid_idx" ON "contacts"("employeeUuid");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
