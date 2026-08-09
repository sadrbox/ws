-- Лицензирование ЭСФ по БИН для 1С-расширения esf_exchange.
-- Стандартная структура справочника: id (PK) + uuid (unique). Бизнес-ключ bin — unique
-- (публичные /api1/esf-license/* находят запись по bin; админка — по uuid).
CREATE TABLE "esf_licenses" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "lastRequestAt" TIMESTAMP(3),
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastRequestInstallId" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastHeartbeatInstallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "esf_licenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "esf_licenses_uuid_key" ON "esf_licenses"("uuid");
CREATE UNIQUE INDEX "esf_licenses_bin_key" ON "esf_licenses"("bin");
CREATE INDEX "esf_licenses_active_idx" ON "esf_licenses"("active");
CREATE INDEX "esf_licenses_lastRequestAt_idx" ON "esf_licenses"("lastRequestAt");
