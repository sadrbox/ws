-- CreateTable
CREATE TABLE "month_closes" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "comment" TEXT,
    "organizationUuid" TEXT,
    "authorUuid" TEXT NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "month_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "month_closes_uuid_key" ON "month_closes"("uuid");

-- CreateIndex
CREATE INDEX "month_closes_organizationUuid_idx" ON "month_closes"("organizationUuid");

-- CreateIndex
CREATE INDEX "month_closes_periodEnd_idx" ON "month_closes"("periodEnd");

-- CreateIndex
CREATE INDEX "month_closes_date_idx" ON "month_closes"("date");

-- CreateIndex
CREATE INDEX "month_closes_updatedAt_idx" ON "month_closes"("updatedAt");

-- AddForeignKey
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;
