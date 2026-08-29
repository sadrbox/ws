-- BuhProf AI Service: базовая схема.
--
-- Идентификаторы ERP (organization_uuid, user_uuid) хранятся как text без внешних ключей:
-- база ERP — другая база, и её жизненный цикл не наш.

-- Агенты: один агент = одна база 1С одной организации ERP.
CREATE TABLE agents (
    id                 uuid PRIMARY KEY,
    organization_uuid  text NOT NULL,
    name               text NOT NULL DEFAULT '',
    -- SHA-256 от токена; сам токен показывается один раз при регистрации.
    token_hash         text NOT NULL,
    version            text,
    os                 text,
    capabilities       jsonb NOT NULL DEFAULT '[]',
    status             text NOT NULL DEFAULT 'UNKNOWN',
    onec_reachable     boolean NOT NULL DEFAULT false,
    onec_version       text,
    last_seen_at       timestamptz,
    registered_at      timestamptz,
    disabled_at        timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_org_idx ON agents (organization_uuid);

-- Команды агентам. Жизненный цикл: queued -> dispatched -> done | failed | expired.
CREATE TABLE commands (
    id                 text PRIMARY KEY,
    agent_id           uuid NOT NULL REFERENCES agents(id),
    organization_uuid  text NOT NULL,
    -- requestId идемпотентности 1С; уникален в пределах агента — повтор команды
    -- с тем же requestId 1С обработает как повтор, а не новый документ.
    request_id         text,
    type               text NOT NULL,
    payload            jsonb NOT NULL DEFAULT '{}',
    state              text NOT NULL DEFAULT 'queued',
    -- Кто и откуда: пользователь ERP и диалог, породившие команду.
    user_uuid          text,
    conversation_id    uuid,
    result_status      text,
    result             jsonb,
    error              jsonb,
    onec_http_status   integer,
    created_at         timestamptz NOT NULL DEFAULT now(),
    dispatched_at      timestamptz,
    finished_at        timestamptz,
    expires_at         timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);
CREATE INDEX commands_agent_state_idx ON commands (agent_id, state, created_at);
CREATE INDEX commands_conversation_idx ON commands (conversation_id);

-- Диалоги пользователей: состояние workflow живёт здесь, а не в памяти процесса (§16 ТЗ).
CREATE TABLE conversations (
    id                 uuid PRIMARY KEY,
    organization_uuid  text NOT NULL,
    user_uuid          text NOT NULL,
    agent_id           uuid REFERENCES agents(id),
    state              text NOT NULL DEFAULT 'IDLE',
    -- Текущее намерение и уже разрешённые сущности — чтобы после уточнения продолжить.
    context            jsonb NOT NULL DEFAULT '{}',
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_idx ON conversations (user_uuid, updated_at DESC);

CREATE TABLE messages (
    id                 bigserial PRIMARY KEY,
    conversation_id    uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role               text NOT NULL,            -- user | assistant | tool
    content            jsonb NOT NULL,           -- текст или блоки (tool_use / tool_result)
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, id);

-- Аудит (§19 ТЗ): каждое значимое событие, без секретов.
CREATE TABLE audit_log (
    id                 bigserial PRIMARY KEY,
    at                 timestamptz NOT NULL DEFAULT now(),
    organization_uuid  text,
    user_uuid          text,
    agent_id           uuid,
    conversation_id    uuid,
    command_id         text,
    request_id         text,
    event              text NOT NULL,
    details            jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_conversation_idx ON audit_log (conversation_id);
