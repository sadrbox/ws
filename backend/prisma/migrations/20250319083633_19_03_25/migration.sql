-- DropIndex
DROP INDEX `Counterparty_shortName_key` ON `Counterparty`;

-- DropIndex
DROP INDEX `Organization_shortName_key` ON `Organization`;

-- AlterTable
ALTER TABLE `Counterparty` MODIFY `shortName` VARCHAR(191) NULL,
    MODIFY `displayName` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Organization` MODIFY `shortName` VARCHAR(191) NULL,
    MODIFY `displayName` VARCHAR(191) NULL;
