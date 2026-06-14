-- CreateTable
CREATE TABLE "fiscal_receipts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentUuid" TEXT NOT NULL,
    "documentId" INTEGER,
    "organizationUuid" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'stub',
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'created',
    "paymentId" TEXT,
    "qrPayload" TEXT,
    "fiscalSign" TEXT,
    "fiscalNumber" TEXT,
    "fiscalDate" TIMESTAMP(3),
    "errorMessage" TEXT,
    "raw" JSONB,
    "authorUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fiscal_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_receipts_uuid_key" ON "fiscal_receipts"("uuid");

-- CreateIndex
CREATE INDEX "fiscal_receipts_organizationUuid_idx" ON "fiscal_receipts"("organizationUuid");

-- CreateIndex
CREATE INDEX "fiscal_receipts_documentType_documentUuid_idx" ON "fiscal_receipts"("documentType", "documentUuid");

-- CreateIndex
CREATE INDEX "fiscal_receipts_status_idx" ON "fiscal_receipts"("status");

-- CreateIndex
CREATE INDEX "fiscal_receipts_createdAt_idx" ON "fiscal_receipts"("createdAt");

-- AddForeignKey
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
