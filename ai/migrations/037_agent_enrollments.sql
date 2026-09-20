-- Подключение агента по коду (СВ5, docs/CONTRACT_AGENT_ENROLLMENT_2026-09-19.md).
--
-- Агент сам просит подключение (окно → «Подключить агента по коду…»), администратор BuhProf одобряет заявку в
-- панели, агент получает идентификатор и токен и подставляет их — без копирования двух длинных значений руками.
-- Секрет опроса — только хэшем; токен агента выпускается при первом опросе после одобрения (rotate-token) и здесь
-- не хранится вовсе.
CREATE TABLE IF NOT EXISTS agent_enrollments (
    id                  uuid PRIMARY KEY,
    code                text NOT NULL,
    secret_hash         text NOT NULL,
    -- Повтор с того же компьютера и той же службы, пока заявка не решена, — та же заявка.
    computer            text NOT NULL,
    service_name        text NOT NULL,
    name                text NOT NULL,
    role                text NOT NULL,
    server_name         text,
    version             text,
    ip                  text,
    repeats             integer NOT NULL DEFAULT 0,
    state               text NOT NULL DEFAULT 'PENDING',
    note                text,
    decided_by          text,
    decided_at          timestamptz,
    organization_uuid   text,
    agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
    token_delivered_at  timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    CONSTRAINT agent_enrollments_state_chk CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
    CONSTRAINT agent_enrollments_role_chk CHECK (role IN ('business', 'admin'))
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_enrollments_code_pending_idx ON agent_enrollments (code) WHERE state = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS agent_enrollments_host_pending_idx ON agent_enrollments (lower(computer), lower(service_name)) WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS agent_enrollments_created_idx ON agent_enrollments (created_at DESC);

-- Счётчики выполненных и неудачных команд из heartbeat (панель: карточка агента). Раньше принимались и терялись.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS commands_done integer;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS commands_failed integer;
