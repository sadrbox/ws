-- Лицензирование ЭСФ по БИН для 1С-расширения esf_exchange.
-- Публичные эндпоинты /api1/esf-license/* пишут сюда activation-request/heartbeat,
-- активацией управляет админ-панель (superadmin).
CREATE TABLE "esf_licenses" (
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
    CONSTRAINT "esf_licenses_pkey" PRIMARY KEY ("bin")
);

CREATE INDEX "esf_licenses_active_idx" ON "esf_licenses"("active");
CREATE INDEX "esf_licenses_lastRequestAt_idx" ON "esf_licenses"("lastRequestAt");
