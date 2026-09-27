-- Добор аудита 26.09 (п. 4, исполнитель «backend-платформа»): ключи идемпотентности служебных
-- каналов (services/idempotency.js). Diff схема↔схема от текущей schema.prisma (после миграций
-- 20260926120000/200000/210000), не с базы. IF NOT EXISTS — повторный прогон не роняет миграцию.
-- CreateTable
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_key_key" ON "idempotency_keys"("key");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");
