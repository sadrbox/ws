/*
  Warnings:

  - You are about to drop the column `position` on the `employees` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "employees" DROP COLUMN "position",
ADD COLUMN     "avatarPath" TEXT,
ADD COLUMN     "organizationUuid" TEXT;

-- CreateTable
CREATE TABLE "positions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_history" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" TEXT NOT NULL,
    "salary" DECIMAL(18,2),
    "employeeUuid" TEXT NOT NULL,
    "positionUuid" TEXT,

    CONSTRAINT "employee_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_rights" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'none',
    "employeeUuid" TEXT NOT NULL,

    CONSTRAINT "access_rights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "positions_uuid_key" ON "positions"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "employee_history_uuid_key" ON "employee_history"("uuid");

-- CreateIndex
CREATE INDEX "employee_history_employeeUuid_idx" ON "employee_history"("employeeUuid");

-- CreateIndex
CREATE INDEX "employee_history_positionUuid_idx" ON "employee_history"("positionUuid");

-- CreateIndex
CREATE UNIQUE INDEX "access_rights_uuid_key" ON "access_rights"("uuid");

-- CreateIndex
CREATE INDEX "access_rights_employeeUuid_idx" ON "access_rights"("employeeUuid");

-- CreateIndex
CREATE UNIQUE INDEX "access_rights_employeeUuid_modelName_key" ON "access_rights"("employeeUuid", "modelName");

-- CreateIndex
CREATE INDEX "employees_organizationUuid_idx" ON "employees"("organizationUuid");

-- CreateIndex
CREATE INDEX "sales_contractUuid_idx" ON "sales"("contractUuid");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_positionUuid_fkey" FOREIGN KEY ("positionUuid") REFERENCES "positions"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_rights" ADD CONSTRAINT "access_rights_employeeUuid_fkey" FOREIGN KEY ("employeeUuid") REFERENCES "employees"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
