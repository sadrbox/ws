-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NULL,
    `password` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `firstname` VARCHAR(191) NULL,
    `lastname` VARCHAR(191) NULL,
    `middlename` VARCHAR(191) NULL,
    `fullname` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Counterparty` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `bin` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Organization` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `bin` VARCHAR(191) NULL,

    UNIQUE INDEX `Organization_bin_key`(`bin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityHistories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createDate` DATETIME(3) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `bin` VARCHAR(191) NOT NULL,
    `userName` VARCHAR(191) NOT NULL,
    `userHost` VARCHAR(191) NOT NULL,
    `userIp` VARCHAR(191) NOT NULL,
    `userCity` VARCHAR(191) NOT NULL,
    `objectId` VARCHAR(191) NOT NULL,
    `objectType` VARCHAR(191) NOT NULL,
    `objectName` VARCHAR(191) NOT NULL,
    `props` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ActivityHistories` ADD CONSTRAINT `ActivityHistories_bin_fkey` FOREIGN KEY (`bin`) REFERENCES `Organization`(`bin`) ON DELETE RESTRICT ON UPDATE CASCADE;
