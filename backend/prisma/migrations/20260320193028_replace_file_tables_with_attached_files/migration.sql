/*
  Warnings:

  - You are about to drop the column `email` on the `contact_persons` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `contact_persons` table. All the data in the column will be lost.
  - You are about to drop the column `position` on the `contact_persons` table. All the data in the column will be lost.
  - You are about to drop the `contract_files` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `todo_files` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `uuid` on table `notifications` required. This step will fail if there are existing NULL values in that column.
  - Made the column `isRead` on table `notifications` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdAt` on table `notifications` required. This step will fail if there are existing NULL values in that column.
  - Made the column `uuid` on table `todos` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdAt` on table `todos` required. This step will fail if there are existing NULL values in that column.
  - Made the column `status` on table `todos` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "contract_files" DROP CONSTRAINT "contract_files_contractUuid_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_todoUuid_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_userUuid_fkey";

-- DropForeignKey
ALTER TABLE "todo_files" DROP CONSTRAINT "todo_files_todoUuid_fkey";

-- DropForeignKey
ALTER TABLE "todos" DROP CONSTRAINT "todos_counterpartyUuid_fkey";

-- DropForeignKey
ALTER TABLE "todos" DROP CONSTRAINT "todos_curatorUuid_fkey";

-- DropForeignKey
ALTER TABLE "todos" DROP CONSTRAINT "todos_executorUuid_fkey";

-- DropForeignKey
ALTER TABLE "todos" DROP CONSTRAINT "todos_organizationUuid_fkey";

-- DropIndex
DROP INDEX "notifications_isRead_idx";

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "shortName" TEXT;

-- AlterTable
ALTER TABLE "contact_persons" DROP COLUMN "email",
DROP COLUMN "phone",
DROP COLUMN "position",
ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "uuid" SET NOT NULL,
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "isRead" SET NOT NULL,
ALTER COLUMN "createdAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "todos" ALTER COLUMN "uuid" SET NOT NULL,
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "status" SET NOT NULL;

-- DropTable
DROP TABLE "contract_files";

-- DropTable
DROP TABLE "todo_files";

-- CreateTable
CREATE TABLE "attached_files" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerUuid" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "description" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attached_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attached_files_uuid_key" ON "attached_files"("uuid");

-- CreateIndex
CREATE INDEX "attached_files_ownerType_ownerUuid_idx" ON "attached_files"("ownerType", "ownerUuid");

-- CreateIndex
CREATE INDEX "notifications_userUuid_isRead_idx" ON "notifications"("userUuid", "isRead");

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_curatorUuid_fkey" FOREIGN KEY ("curatorUuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_executorUuid_fkey" FOREIGN KEY ("executorUuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_todoUuid_fkey" FOREIGN KEY ("todoUuid") REFERENCES "todos"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
