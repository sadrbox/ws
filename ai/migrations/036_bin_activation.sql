-- Активация БИНов бизнес-агента (СВ4, docs/CONTRACT_BASE_REGISTRATION_2026-09-19.md, часть 2).
--
-- Правило «первые N БИНов по порядку» зависит от порядка баз и организаций в настройках агента: поменяли порядок —
-- сменились обслуживаемые организации. Явный список решает это: какие БИНы обслуживаются, решает администратор
-- BuhProf по запросу из окна агента. NULL — списка нет, действует прежнее правило.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS active_bins text[];

-- Запросы активации из heartbeat: один на пару «агент + БИН»; повтор того же БИН — обновление прежнего.
CREATE TABLE IF NOT EXISTS bin_activation_requests (
    agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    bin           text NOT NULL,
    name          text,
    base_key      text,
    comment       text,
    requested_at  timestamptz,
    state         text NOT NULL DEFAULT 'PENDING',
    note          text,
    decided_by    text,
    decided_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, bin),
    CONSTRAINT bin_activation_requests_state_chk CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED'))
);
CREATE INDEX IF NOT EXISTS bin_activation_requests_state_idx ON bin_activation_requests (state, updated_at DESC);
