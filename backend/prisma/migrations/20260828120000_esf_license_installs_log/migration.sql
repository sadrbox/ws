-- Установки (базы 1С) и журнал обращений для лицензирования ЭСФ (задачи S-06/S-07).
-- Сгенерировано schema↔schema-диффом (НЕ datasource-diff: тот тянет DROP INDEX
-- на partial-unique индексы штрихкодов, которые Prisma не выражает).
-- AlterTable
ALTER TABLE "esf_licenses" ADD COLUMN     "installLimit" INTEGER;

-- CreateTable
CREATE TABLE "esf_license_installs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIp" TEXT,
    "releasedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "esf_license_installs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esf_license_logs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bin" TEXT,
    "installId" TEXT,
    "endpoint" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "status" INTEGER NOT NULL,
    "ip" TEXT,

    CONSTRAINT "esf_license_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "esf_license_installs_uuid_key" ON "esf_license_installs"("uuid");

-- CreateIndex
CREATE INDEX "esf_license_installs_bin_lastSeenAt_idx" ON "esf_license_installs"("bin", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "esf_license_installs_bin_installId_key" ON "esf_license_installs"("bin", "installId");

-- CreateIndex
CREATE UNIQUE INDEX "esf_license_logs_uuid_key" ON "esf_license_logs"("uuid");

-- CreateIndex
CREATE INDEX "esf_license_logs_createdAt_idx" ON "esf_license_logs"("createdAt");

-- CreateIndex
CREATE INDEX "esf_license_logs_bin_createdAt_idx" ON "esf_license_logs"("bin", "createdAt");

-- CreateIndex
CREATE INDEX "esf_license_logs_endpoint_createdAt_idx" ON "esf_license_logs"("endpoint", "createdAt");

-- AddForeignKey
ALTER TABLE "esf_license_installs" ADD CONSTRAINT "esf_license_installs_bin_fkey" FOREIGN KEY ("bin") REFERENCES "esf_licenses"("bin") ON DELETE CASCADE ON UPDATE CASCADE;

