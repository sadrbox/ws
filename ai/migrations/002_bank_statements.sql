-- Банковские выписки, распознанные из PDF в диалоге (M-bank).
--
-- Распознанная выписка хранится целиком: модель ссылается на неё по id (statementId), а
-- payload для 1С собирается сервисом из этой записи — модель не пересказывает строки и не
-- может их «поправить». Результат загрузки в 1С сохраняется рядом для истории и повторов.
CREATE TABLE bank_statements (
    id                 uuid PRIMARY KEY,
    conversation_id    uuid REFERENCES conversations(id) ON DELETE SET NULL,
    organization_uuid  text NOT NULL,
    user_uuid          text NOT NULL,
    file_name          text NOT NULL,
    file_sha256        text NOT NULL,
    statement          jsonb NOT NULL,           -- Statement (см. src/bank/schema.ts)
    reconciliation     jsonb NOT NULL,           -- результат арифметической сверки
    status             text NOT NULL DEFAULT 'extracted',  -- extracted | imported | failed
    import_result      jsonb,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_statements_conversation_idx ON bank_statements (conversation_id);
CREATE INDEX bank_statements_org_idx ON bank_statements (organization_uuid, created_at DESC);
