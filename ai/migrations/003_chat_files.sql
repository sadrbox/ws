-- Файлы, полученные в диалоге из 1С (печатные формы, отчёты).
--
-- Хранятся в базе сервиса, а не в ответе: ответ с base64 живёт один HTTP-запрос, а файл
-- должен быть доступен при переоткрытии диалога и после фонового хода. Срок хранения
-- ограничен (FILE_TTL_DAYS), просроченные удаляются при старте и раз в час.
CREATE TABLE chat_files (
    id                 uuid PRIMARY KEY,
    conversation_id    uuid REFERENCES conversations(id) ON DELETE CASCADE,
    organization_uuid  text NOT NULL,
    user_uuid          text NOT NULL,
    file_name          text NOT NULL,
    mime_type          text NOT NULL,
    size               integer NOT NULL,
    content            bytea NOT NULL,
    source             jsonb NOT NULL DEFAULT '{}',   -- что напечатано: тип документа, id, форма, формат
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL
);
CREATE INDEX chat_files_conversation_idx ON chat_files (conversation_id);
CREATE INDEX chat_files_expires_idx ON chat_files (expires_at);
