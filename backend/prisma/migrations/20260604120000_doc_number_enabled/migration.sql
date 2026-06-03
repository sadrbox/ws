-- Тумблер автонумерации по виду документа.
ALTER TABLE "document_number_settings" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
