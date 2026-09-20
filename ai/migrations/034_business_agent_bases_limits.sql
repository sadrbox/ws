-- МНОГОБАЗОВЫЙ БИЗНЕС-АГЕНТ И ЛИМИТ ТАРИФА (СВ3, 19.09).
--
-- Одна служба бизнес-агента обслуживает сколько угодно баз одного компьютера (по HTTP или по COM), а сколько баз и
-- БИНов ей можно обслуживать — решает сервис. Агент применяет лимит сам, но главный контроль — здесь: команду сверх
-- лимита сервис не ставит в очередь вовсе.

-- Лимит тарифа у агента. NULL — без ограничения. Смена действует со следующего heartbeat: агент получает лимиты в
-- ответах register и heartbeat.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_bases integer;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_bins integer;

-- Срез баз бизнес-агента: его базы в ЕГО порядке (порядок настроек агента — по нему считается лимит), транспорт,
-- версия расширения, организации с БИН и признак «сверх лимита» от агента.
--
-- Отдельно от `bases`: реестр `bases` — это базы СЕРВЕРА (их перечисляет кластер админ-агента), а здесь — то, что
-- видит и обслуживает конкретная служба, в её порядке. Порядок и организации принадлежат агенту, не кластеру.
CREATE TABLE IF NOT EXISTS agent_bases (
    agent_id       uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    key            text        NOT NULL,
    -- Позиция в срезе агента: первые max_bases по ней обслуживаются, остальные — сверх лимита.
    pos            integer     NOT NULL,
    status         text,
    -- 'http' | 'com'; NULL — агент не сообщил.
    transport      text,
    ext_version    text,
    -- Сверх лимита по мнению самого агента; NULL — агент лимитов не применял (старая сборка).
    over_limit     boolean,
    -- [{id, name, bin}] в порядке агента; NULL — агент организаций не сообщил («не знаю»), [] — их нет.
    organizations  jsonb,
    seen_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, key)
);

CREATE INDEX IF NOT EXISTS agent_bases_agent_pos_idx ON agent_bases (agent_id, pos);
