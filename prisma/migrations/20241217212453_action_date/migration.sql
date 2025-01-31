/*
  Warnings:

  - You are about to drop the column `action` on the `ActivityHistory` table. All the data in the column will be lost.
  - You are about to drop the column `createDate` on the `ActivityHistory` table. All the data in the column will be lost.
  - Added the required column `actionType` to the `ActivityHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `ActivityHistory` DROP COLUMN `action`,
    DROP COLUMN `createDate`,
    ADD COLUMN `actionDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `actionType` VARCHAR(191) NOT NULL;
