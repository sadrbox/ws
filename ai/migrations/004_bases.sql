-- Модель «сервер 1С → базы → агенты» (E15/A1).
--
-- ЗАЧЕМ. До этой миграции агент = одна база одной организации: команда адресовалась парой
-- (agent_id, organization_uuid), а состояние 1С умещалось в два поля agents.onec_*. Для
-- бухгалтерской компании со ста базами клиентов на одном сервере это не выражается вовсе:
-- организация ERP одна, а баз сто.
--
-- Теперь агент привязан к СЕРВЕРУ и имеет РОЛЬ (см. §3.1 ТЗ):
--   business — работает внутри баз через расширение bpapi (документы, справочники);
--   admin    — работает с кластером через rac и с базами через COM (сеансы, пользователи ИБ).
-- Это разные службы под разными учётками ОС: компрометация бизнес-пути не должна давать
-- прав администратора кластера.
--
-- Источник истины по СПИСКУ баз — админ-агент (видит их через rac). Бизнес-агент подтверждает
-- наличие и версию расширения. Поэтому в bases часть колонок заполняет один, часть — другой,
-- и upsert обновляет только то, что реально прислали (NULL = «не знаю», а не «пусто»).

-- Сервер (кластер) 1С. Имя — то, под которым его знает организация; ras_* нужны админ-агенту.
CREATE TABLE servers (
    id                 uuid PRIMARY KEY,
    organization_uuid  text NOT NULL,
    name               text NOT NULL DEFAULT '',
    ras_host           text,
    ras_port           integer,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX servers_org_idx ON servers (organization_uuid);
-- Имя сервера уникально внутри организации: по нему агент находит свой сервер при регистрации.
CREATE UNIQUE INDEX servers_org_name_idx ON servers (organization_uuid, name);

ALTER TABLE agents ADD COLUMN server_id uuid REFERENCES servers(id);
ALTER TABLE agents ADD COLUMN role text NOT NULL DEFAULT 'business';
ALTER TABLE agents ADD CONSTRAINT agents_role_chk CHECK (role IN ('business', 'admin'));
-- Когда агент в последний раз присылал ПОЛНЫЙ срез по базам. Между полными срезами он шлёт
-- дельты: сто баз каждые 30 секунд — это лишний трафик и лишние обращения к кластеру.
ALTER TABLE agents ADD COLUMN bases_synced_at timestamptz;

CREATE TABLE bases (
    id                 uuid PRIMARY KEY,
    server_id          uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    -- Имя информационной базы в кластере — то, что видит rac и что пишут в строке соединения.
    key                text NOT NULL,
    name               text NOT NULL DEFAULT '',
    status             text NOT NULL DEFAULT 'UNKNOWN',
    onec_version       text,
    -- Версия расширения bpapi в этой базе; NULL = не установлено или ещё не проверяли.
    ext_version        text,
    sessions_count     integer,
    last_seen_at       timestamptz,
    disabled_at        timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bases_server_key_idx ON bases (server_id, key);
CREATE INDEX bases_server_idx ON bases (server_id);

-- Команда адресуется базе. NULL = псевдо-база 'default': так выглядят команды от агентов
-- старого протокола (v1), у которых базы одна и она не названа.
ALTER TABLE commands ADD COLUMN base_key text;
CREATE INDEX commands_base_idx ON commands (agent_id, base_key, state);

-- Идемпотентность: request_id уникален в пределах пары (агент, база), а не агента —
-- одинаковый requestId для РАЗНЫХ баз это разные операции.
--
-- Индекс частичный, только по незавершённым командам, и вот почему: он защищает от повторной
-- ПОСТАНОВКИ той же команды в очередь (двойное нажатие, ретрай HTTP), а не от повторной
-- отправки в 1С — там идемпотентность обеспечивает сам requestId на стороне базы. Полный
-- индекс запретил бы законный повтор операции спустя время с тем же requestId.
--
-- Перед созданием индекса разводим возможные существующие дубли: оставляем самую раннюю
-- команду (она могла быть уже выдана агенту), остальные помечаем expired.
UPDATE commands c SET state = 'expired', finished_at = now()
 WHERE c.request_id IS NOT NULL
   AND c.state IN ('queued', 'dispatched')
   AND EXISTS (
        SELECT 1 FROM commands o
         WHERE o.request_id = c.request_id
           AND o.agent_id = c.agent_id
           AND COALESCE(o.base_key, '') = COALESCE(c.base_key, '')
           AND o.state IN ('queued', 'dispatched')
           AND (o.created_at, o.id) < (c.created_at, c.id));

CREATE UNIQUE INDEX commands_agent_base_request_idx
    ON commands (agent_id, COALESCE(base_key, ''), request_id)
 WHERE request_id IS NOT NULL AND state IN ('queued', 'dispatched');
