-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NULL,
    `password` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `firstname` VARCHAR(191) NULL,
    `lastname` VARCHAR(191) NULL,
    `middlename` VARCHAR(191) NULL,
    `fullname` VARCHAR(191) NULL,

    UNIQUE INDEX `User_uuid_key`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Organization` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `shortName` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL DEFAULT '',
    `bin` VARCHAR(12) NOT NULL,

    UNIQUE INDEX `Organization_uuid_key`(`uuid`),
    UNIQUE INDEX `Organization_shortName_key`(`shortName`),
    UNIQUE INDEX `Organization_bin_key`(`bin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Counterparty` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `shortName` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL DEFAULT '',
    `bin` VARCHAR(12) NOT NULL,

    UNIQUE INDEX `Counterparty_uuid_key`(`uuid`),
    UNIQUE INDEX `Counterparty_shortName_key`(`shortName`),
    UNIQUE INDEX `Counterparty_bin_key`(`bin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `shortName` VARCHAR(191) NOT NULL,
    `contractNumber` VARCHAR(191) NULL,
    `contractText` TEXT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `organizationUuid` VARCHAR(191) NULL,
    `counterpartyUuid` VARCHAR(191) NULL,

    UNIQUE INDEX `Contract_uuid_key`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `contactTypeUuid` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `ownerType` VARCHAR(191) NOT NULL,
    `organizationUuid` VARCHAR(191) NULL,
    `counterpartyUuid` VARCHAR(191) NULL,

    UNIQUE INDEX `Contact_uuid_key`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `shortName` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ContactType_uuid_key`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `actionDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actionType` VARCHAR(191) NOT NULL,
    `organizationUuid` VARCHAR(191) NOT NULL,
    `organizationShortName` VARCHAR(191) NOT NULL,
    `bin` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `host` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `objectId` VARCHAR(191) NOT NULL,
    `objectType` VARCHAR(191) NOT NULL,
    `objectName` VARCHAR(191) NOT NULL,
    `props` JSON NOT NULL,

    UNIQUE INDEX `ActivityHistory_uuid_key`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Contract` ADD CONSTRAINT `Contract_organizationUuid_fkey` FOREIGN KEY (`organizationUuid`) REFERENCES `Organization`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contract` ADD CONSTRAINT `Contract_counterpartyUuid_fkey` FOREIGN KEY (`counterpartyUuid`) REFERENCES `Counterparty`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_contactTypeUuid_fkey` FOREIGN KEY (`contactTypeUuid`) REFERENCES `ContactType`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_organizationUuid_fkey` FOREIGN KEY (`organizationUuid`) REFERENCES `Organization`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_counterpartyUuid_fkey` FOREIGN KEY (`counterpartyUuid`) REFERENCES `Counterparty`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityHistory` ADD CONSTRAINT `ActivityHistory_organizationUuid_fkey` FOREIGN KEY (`organizationUuid`) REFERENCES `Organization`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;
