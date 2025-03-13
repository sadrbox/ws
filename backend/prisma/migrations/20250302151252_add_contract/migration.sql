-- CreateTable
CREATE TABLE `Contract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `counterpartyId` INTEGER NOT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Contract` ADD CONSTRAINT `Contract_counterpartyId_fkey` FOREIGN KEY (`counterpartyId`) REFERENCES `Counterparty`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
