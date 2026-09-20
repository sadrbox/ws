-- Канал «чат внутри 1С» (СВ1, docs/CONTRACT_1C_CHAT_2026-09-19.md).
--
-- Форма BPAPI_Чат ходит в сервис сама, от имени базы: токен базы (X-Base-Token) + UUID пользователя ИБ
-- (X-1C-User-Id). Токен привязан к базе, база — к организации ERP (для учёта, лимитов и истории). Хранится
-- только SHA-256; сам токен показывается один раз при выпуске. Отзыв — revoked_at, строка остаётся: по ней
-- видно, кто и когда выпускал и отзывал.
CREATE TABLE base_tokens (
    id                 uuid PRIMARY KEY,
    base_id            uuid NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
    organization_uuid  text NOT NULL,
    token_hash         text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         text NOT NULL DEFAULT '',
    revoked_at         timestamptz,
    revoked_by         text
);
CREATE UNIQUE INDEX base_tokens_hash_idx ON base_tokens (token_hash);
CREATE INDEX base_tokens_base_idx ON base_tokens (base_id);

-- Диалог принадлежит паре «база + пользователь 1С». Владелец по-прежнему в (organization_uuid, user_uuid) —
-- для канала 1c user_uuid = '1c:<base_id>:<uuid пользователя ИБ>', так что чужие диалоги не видны ни ERP,
-- ни другой базе. channel и base_id — для отбора и отчётов, onec_user_name — подпись в истории.
ALTER TABLE conversations ADD COLUMN channel text NOT NULL DEFAULT 'erp';
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_chk CHECK (channel IN ('erp', '1c'));
ALTER TABLE conversations ADD COLUMN base_id uuid;
ALTER TABLE conversations ADD COLUMN onec_user_name text;
