/*
  Warnings:

  - You are about to drop the `ActivityHistories` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `ActivityHistories` DROP FOREIGN KEY `ActivityHistories_bin_fkey`;

-- DropTable
DROP TABLE `ActivityHistories`;

-- CreateTable
CREATE TABLE `ActivityHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actionDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actionType` VARCHAR(191) NOT NULL,
    `bin` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `host` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `objectId` VARCHAR(191) NOT NULL,
    `objectType` VARCHAR(191) NOT NULL,
    `objectName` VARCHAR(191) NOT NULL,
    `props` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ActivityHistory` ADD CONSTRAINT `ActivityHistory_bin_fkey` FOREIGN KEY (`bin`) REFERENCES `Organization`(`bin`) ON DELETE RESTRICT ON UPDATE CASCADE;
