/*
  Warnings:

  - You are about to drop the column `firstName` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `fullName` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `middleName` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "firstName",
DROP COLUMN "fullName",
DROP COLUMN "lastName",
DROP COLUMN "middleName",
ADD COLUMN     "employeeUuid" TEXT;

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,
    "fullName" VARCHAR(255),
    "iin" VARCHAR(12),
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_uuid_key" ON "employees"("uuid");

-- CreateIndex
CREATE INDEX "users_employeeUuid_idx" ON "users"("employeeUuid");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
