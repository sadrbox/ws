/*
  Warnings:

  - You are about to drop the column `name` on the `Contract` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Organization` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[bin]` on the table `Counterparty` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `ownerId` to the `Contact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerType` to the `Contact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `shortName` to the `Contract` table without a default value. This is not possible if the table is not empty.
  - Added the required column `shortName` to the `Organization` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `Contract` DROP FOREIGN KEY `Contract_counterpartyId_fkey`;

-- DropIndex
DROP INDEX `Contract_counterpartyId_fkey` ON `Contract`;

-- AlterTable
ALTER TABLE `Contact` ADD COLUMN `counterpartyId` INTEGER NULL,
    ADD COLUMN `organizationId` INTEGER NULL,
    ADD COLUMN `ownerId` INTEGER NOT NULL,
    ADD COLUMN `ownerType` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `Contract` DROP COLUMN `name`,
    ADD COLUMN `contractNumber` VARCHAR(191) NULL,
    ADD COLUMN `contractText` TEXT NULL,
    ADD COLUMN `organizationId` INTEGER NULL,
    ADD COLUMN `shortName` VARCHAR(191) NOT NULL,
    MODIFY `counterpartyId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Organization` DROP COLUMN `name`,
    ADD COLUMN `displayName` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `shortName` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Counterparty_bin_key` ON `Counterparty`(`bin`);

-- AddForeignKey
ALTER TABLE `Contract` ADD CONSTRAINT `Contract_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contract` ADD CONSTRAINT `Contract_counterpartyId_fkey` FOREIGN KEY (`counterpartyId`) REFERENCES `Counterparty`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_counterpartyId_fkey` FOREIGN KEY (`counterpartyId`) REFERENCES `Counterparty`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
