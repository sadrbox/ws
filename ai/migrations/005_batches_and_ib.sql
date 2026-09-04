-- Пакетные операции по базам и реестр «что внутри базы» (E15/A4 + A3-внутрибазовые).
--
-- ЗАЧЕМ ПАКЕТЫ. «Добавить пользователя во все базы» — это не одна команда, а сто:
-- каждая база отдельное соединение, отдельный результат, отдельная ошибка. Без общего
-- задания пользователь видел бы сто независимых операций и не знал, где что упало.
-- Задание собирает их вместе: сколько всего, сколько готово, где ошибка, что повторить.
CREATE TABLE command_batches (
    id                 uuid PRIMARY KEY,
    organization_uuid  text NOT NULL,
    user_uuid          text,
    -- Тип команды, размноженной по базам (IB_CREATE_USER и т.п.).
    type               text NOT NULL,
    -- Общая часть payload; ключ базы подставляется на каждую команду свой.
    payload            jsonb NOT NULL DEFAULT '{}',
    total              integer NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX command_batches_org_idx ON command_batches (organization_uuid, created_at DESC);

-- Команда знает своё задание: прогресс считается запросом по batch_id, отдельных
-- счётчиков нет — их пришлось бы держать в согласии с состоянием команд.
ALTER TABLE commands ADD COLUMN batch_id uuid REFERENCES command_batches(id) ON DELETE SET NULL;
CREATE INDEX commands_batch_idx ON commands (batch_id);

-- Пользователи ИБ, как их последний раз видели. Кэш, а не источник истины: нужен,
-- чтобы «в каких базах есть этот пользователь» не означало сто подключений к 1С на
-- каждый показ. Обновляется результатом IB_LIST_USERS.
CREATE TABLE base_users (
    id         uuid PRIMARY KEY,
    base_id    uuid NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
    name       text NOT NULL,
    full_name  text NOT NULL DEFAULT '',
    disabled   boolean NOT NULL DEFAULT false,
    roles      jsonb NOT NULL DEFAULT '[]',
    seen_at    timestamptz NOT NULL DEFAULT now()
);
-- Имя пользователя ИБ регистронезависимо для человека, поэтому и ключ такой.
CREATE UNIQUE INDEX base_users_base_name_idx ON base_users (base_id, lower(name));
CREATE INDEX base_users_name_idx ON base_users (lower(name));

-- Расширения базы — тот же кэш и та же причина.
CREATE TABLE base_extensions (
    id         uuid PRIMARY KEY,
    base_id    uuid NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
    name       text NOT NULL,
    version    text,
    purpose    text,
    safe_mode  boolean,
    seen_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX base_extensions_base_name_idx ON base_extensions (base_id, lower(name));
CREATE INDEX base_extensions_name_idx ON base_extensions (lower(name));
