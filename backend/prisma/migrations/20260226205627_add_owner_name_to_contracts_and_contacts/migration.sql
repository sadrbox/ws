/*
  Warnings:

  - You are about to drop the column `createdAt` on the `bank_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `bank_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `contracts` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `contracts` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `counterparties` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `counterparties` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bank_accounts" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
ADD COLUMN     "ownerName" TEXT;

-- AlterTable
ALTER TABLE "contracts" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
ADD COLUMN     "ownerName" TEXT;

-- AlterTable
ALTER TABLE "counterparties" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt";
