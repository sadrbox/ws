-- Состояние базы после изменяющих команд (TASK_SERVICE_ECHO_WRITE_COMMANDS.md, S1 и S3).
--
-- БЛОКИРОВКА НАЧАЛА СЕАНСОВ. Команда CLUSTER_SET_SESSIONS_LOCK отвечала {ok}, а состояние
-- блокировки не хранилось нигде — включена ли она, из панели было не узнать. Трёхзначно:
-- NULL — не знаем. Источник: 'cluster' — прочитано у кластера (эхо команды или срез баз),
-- 'command' — записано по факту успешной команды панели, когда кластер состояние не сообщил.
ALTER TABLE bases
	ADD COLUMN sessions_denied boolean,
	ADD COLUMN sessions_denied_message text,
	ADD COLUMN sessions_denied_from text,
	ADD COLUMN sessions_denied_to text,
	ADD COLUMN sessions_denied_seen_at timestamptz,
	ADD COLUMN sessions_denied_source text CHECK (sessions_denied_source IN ('cluster', 'command'));

-- КОНФИГУРАЦИЯ БАЗЫ. onec_version — версия ПЛАТФОРМЫ (8.3.25…); версии конфигурации не было
-- нигде, и после обновления конфигурации её нечем было показать.
ALTER TABLE bases
	ADD COLUMN config_name text,
	ADD COLUMN config_version text,
	ADD COLUMN config_seen_at timestamptz;
