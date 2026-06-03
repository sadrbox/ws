-- Префиксы нумерации по организации (по умолчанию "__global__").
ALTER TABLE "document_number_settings" ADD COLUMN "organizationUuid" TEXT NOT NULL DEFAULT '__global__';
DROP INDEX IF EXISTS "document_number_settings_docType_key";
CREATE UNIQUE INDEX "document_number_settings_organizationUuid_docType_key" ON "document_number_settings"("organizationUuid", "docType");
