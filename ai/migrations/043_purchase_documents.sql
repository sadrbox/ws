-- Первичные документы поставщиков, распознанные из PDF в диалоге (И2).
--
-- Как bank_statements: документ хранится целиком, модель ссылается на него по id
-- (purchaseDocumentId), payload для 1С собирает сервис из этой записи. Между шагами
-- «сопоставить» и «создать» состояние держит сервис, а не 1С: ответ сопоставления
-- сохраняется здесь же (match_result) — без него создание не пропускается.
CREATE TABLE purchase_documents (
    id                 uuid PRIMARY KEY,
    conversation_id    uuid REFERENCES conversations(id) ON DELETE SET NULL,
    organization_uuid  text NOT NULL,
    user_uuid          text NOT NULL,
    file_name          text NOT NULL,
    file_sha256        text NOT NULL,
    document           jsonb NOT NULL,           -- PurchaseDocument (см. src/purchase/schema.ts)
    check_result       jsonb NOT NULL,           -- арифметическая проверка
    status             text NOT NULL DEFAULT 'extracted',  -- extracted | matched | created | failed
    match_result       jsonb,
    create_result      jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_documents_conversation_idx ON purchase_documents (conversation_id);
CREATE INDEX purchase_documents_org_idx ON purchase_documents (organization_uuid, created_at DESC);
