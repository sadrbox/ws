/*
  Warnings:

  - You are about to drop the column `userCity` on the `ActivityHistories` table. All the data in the column will be lost.
  - You are about to drop the column `userHost` on the `ActivityHistories` table. All the data in the column will be lost.
  - You are about to drop the column `userIp` on the `ActivityHistories` table. All the data in the column will be lost.
  - Added the required column `city` to the `ActivityHistories` table without a default value. This is not possible if the table is not empty.
  - Added the required column `host` to the `ActivityHistories` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ip` to the `ActivityHistories` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `ActivityHistories` DROP COLUMN `userCity`,
    DROP COLUMN `userHost`,
    DROP COLUMN `userIp`,
    ADD COLUMN `city` VARCHAR(191) NOT NULL,
    ADD COLUMN `host` VARCHAR(191) NOT NULL,
    ADD COLUMN `ip` VARCHAR(191) NOT NULL;
