/*
  Warnings:

  - You are about to drop the column `ownerType` on the `contracts` table. All the data in the column will be lost.
  - You are about to drop the column `ownerUuid` on the `contracts` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "contracts_ownerType_ownerUuid_idx";

-- AlterTable
ALTER TABLE "contracts" DROP COLUMN "ownerType",
DROP COLUMN "ownerUuid";
