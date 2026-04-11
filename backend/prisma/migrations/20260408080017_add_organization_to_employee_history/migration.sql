/*
  Warnings:

  - You are about to drop the column `employeeUuid` on the `access_rights` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userUuid,modelName]` on the table `access_rights` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[inviteCode]` on the table `organizations` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userUuid` to the `access_rights` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "access_rights" DROP CONSTRAINT "access_rights_employeeUuid_fkey";

-- DropIndex
DROP INDEX "access_rights_employeeUuid_idx";

-- DropIndex
DROP INDEX "access_rights_employeeUuid_modelName_key";

-- AlterTable
ALTER TABLE "access_rights" DROP COLUMN "employeeUuid",
ADD COLUMN     "userUuid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "contact_persons" ADD COLUMN     "avatarPath" TEXT;

-- AlterTable
ALTER TABLE "employee_history" ADD COLUMN     "organizationUuid" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "inviteCode" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarPath" TEXT,
ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizationUuid" TEXT;

-- CreateIndex
CREATE INDEX "access_rights_userUuid_idx" ON "access_rights"("userUuid");

-- CreateIndex
CREATE UNIQUE INDEX "access_rights_userUuid_modelName_key" ON "access_rights"("userUuid", "modelName");

-- CreateIndex
CREATE INDEX "employee_history_organizationUuid_idx" ON "employee_history"("organizationUuid");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_inviteCode_key" ON "organizations"("inviteCode");

-- CreateIndex
CREATE INDEX "users_organizationUuid_idx" ON "users"("organizationUuid");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_rights" ADD CONSTRAINT "access_rights_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
