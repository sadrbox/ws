-- CreateTable
CREATE TABLE "edo_documents" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "senderOrgUuid" TEXT NOT NULL,
    "senderBin" TEXT NOT NULL,
    "receiverBin" TEXT NOT NULL,
    "receiverOrgUuid" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "number" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "sourceDocType" TEXT,
    "sourceDocUuid" TEXT,
    "canonicalXml" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "authorUuid" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "edo_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edo_signatures" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "edoDocumentUuid" TEXT NOT NULL,
    "orgUuid" TEXT NOT NULL,
    "userUuid" TEXT,
    "role" TEXT NOT NULL,
    "signedXml" TEXT,
    "certificate" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edo_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edo_documents_uuid_key" ON "edo_documents"("uuid");

-- CreateIndex
CREATE INDEX "edo_documents_senderOrgUuid_idx" ON "edo_documents"("senderOrgUuid");

-- CreateIndex
CREATE INDEX "edo_documents_receiverOrgUuid_idx" ON "edo_documents"("receiverOrgUuid");

-- CreateIndex
CREATE INDEX "edo_documents_receiverBin_idx" ON "edo_documents"("receiverBin");

-- CreateIndex
CREATE INDEX "edo_documents_status_idx" ON "edo_documents"("status");

-- CreateIndex
CREATE INDEX "edo_documents_sourceDocType_sourceDocUuid_idx" ON "edo_documents"("sourceDocType", "sourceDocUuid");

-- CreateIndex
CREATE INDEX "edo_documents_date_idx" ON "edo_documents"("date");

-- CreateIndex
CREATE INDEX "edo_documents_updatedAt_idx" ON "edo_documents"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "edo_signatures_uuid_key" ON "edo_signatures"("uuid");

-- CreateIndex
CREATE INDEX "edo_signatures_edoDocumentUuid_idx" ON "edo_signatures"("edoDocumentUuid");

-- CreateIndex
CREATE INDEX "edo_signatures_orgUuid_idx" ON "edo_signatures"("orgUuid");

-- AddForeignKey
ALTER TABLE "edo_signatures" ADD CONSTRAINT "edo_signatures_edoDocumentUuid_fkey" FOREIGN KEY ("edoDocumentUuid") REFERENCES "edo_documents"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

