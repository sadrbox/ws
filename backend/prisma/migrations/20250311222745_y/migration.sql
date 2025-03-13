/*
  Warnings:

  - You are about to drop the column `shortName` on the `Contact` table. All the data in the column will be lost.
  - Added the required column `value` to the `Contact` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Contact` DROP COLUMN `shortName`,
    ADD COLUMN `value` VARCHAR(191) NOT NULL;
