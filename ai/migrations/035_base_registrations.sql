-- Регистрация базы 1С из самой базы (СВ4, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md, часть 1).
--
-- Администратор базы отправляет заявку из формы «Подключение к BuhProf AI», администратор BuhProf одобряет её в
-- панели, токен базы уходит в 1С при первом опросе после одобрения. Секрет опроса хранится только хэшем, токен —
-- в base_tokens (тоже хэшем); здесь только ссылка на него.
CREATE TABLE IF NOT EXISTS base_registrations (
    id                  uuid PRIMARY KEY,
    code                text NOT NULL,
    secret_hash         text NOT NULL,
    -- Идентификатор ИБ из 1С (БСП) — по нему повтор заявки узнаётся как та же заявка.
    onec_base_id        text NOT NULL,
    base_name           text NOT NULL,
    -- Заявка как есть: база, организации с БИН, кто отправил, контакт, комментарий.
    body                jsonb NOT NULL,
    ip                  text,
    repeats             integer NOT NULL DEFAULT 0,
    state               text NOT NULL DEFAULT 'PENDING',
    note                text,
    decided_by          text,
    decided_at          timestamptz,
    organization_uuid   text,
    base_id             uuid REFERENCES bases(id) ON DELETE SET NULL,
    base_key            text,
    token_id            uuid REFERENCES base_tokens(id) ON DELETE SET NULL,
    token_delivered_at  timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    CONSTRAINT base_registrations_state_chk CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'))
);
-- Код называют по телефону: среди нерешённых он уникален. Одна нерешённая заявка на базу.
CREATE UNIQUE INDEX IF NOT EXISTS base_registrations_code_pending_idx ON base_registrations (code) WHERE state = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS base_registrations_base_pending_idx ON base_registrations (onec_base_id) WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS base_registrations_created_idx ON base_registrations (created_at DESC);
