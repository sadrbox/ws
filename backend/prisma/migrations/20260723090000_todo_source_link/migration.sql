-- Полиморфная ссылка задачи на объект-источник (документ/справочник/заметка).
-- Конвенция как у basisDocumentType/Uuid/Label: sourceType = endpoint модели,
-- sourceLabel = подпись на момент связывания (переживает удаление объекта).
ALTER TABLE "todos" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "todos" ADD COLUMN "sourceUuid" TEXT;
ALTER TABLE "todos" ADD COLUMN "sourceLabel" TEXT;

CREATE INDEX "todos_sourceType_sourceUuid_idx" ON "todos"("sourceType", "sourceUuid");
