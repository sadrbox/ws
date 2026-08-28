-- E9 CRM: сделки (воронка продаж). Таблица deals + FK на организацию/контрагента/
-- пользователя (ответственный). Написано ВРУЧНУЮ по schema↔schema-диффу: полный
-- дифф тянет посторонний дрейф (DROP INDEX на partial-unique индексы штрихкодов и
-- trigram-индексы, которые Prisma не выражает; переименования constraint'ов) —
-- он сюда НЕ включён, только создание deals.

-- CreateTable
CREATE TABLE "deals" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "status" TEXT NOT NULL DEFAULT 'open',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseDate" TIMESTAMP(3),
    "comment" TEXT,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "responsibleUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deals_uuid_key" ON "deals"("uuid");
-- CreateIndex
CREATE INDEX "deals_organizationUuid_idx" ON "deals"("organizationUuid");
-- CreateIndex
CREATE INDEX "deals_counterpartyUuid_idx" ON "deals"("counterpartyUuid");
-- CreateIndex
CREATE INDEX "deals_responsibleUuid_idx" ON "deals"("responsibleUuid");
-- CreateIndex
CREATE INDEX "deals_stage_idx" ON "deals"("stage");
-- CreateIndex
CREATE INDEX "deals_updatedAt_idx" ON "deals"("updatedAt");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_responsibleUuid_fkey" FOREIGN KEY ("responsibleUuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
