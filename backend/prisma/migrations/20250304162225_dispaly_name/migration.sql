/*
  Warnings:

  - You are about to drop the column `name` on the `Counterparty` table. All the data in the column will be lost.
  - Added the required column `shortName` to the `Counterparty` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Counterparty` DROP COLUMN `name`,
    ADD COLUMN `displayName` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `shortName` VARCHAR(191) NOT NULL;

-- CreateTable
CREATE TABLE `Contact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shortName` VARCHAR(191) NOT NULL,
    `contactTypeId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shortName` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_contactTypeId_fkey` FOREIGN KEY (`contactTypeId`) REFERENCES `ContactType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
