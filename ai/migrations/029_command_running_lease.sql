-- Продление срока выполняемых команд (решение В2 по С24, задача С33).
--
-- started_at      — когда агент начал работу (получил исполнителя), из `running[].startedAt` heartbeat.
-- running_seen_at — когда агент последний раз подтвердил heartbeat'ом, что команда выполняется. По нему
--                   сервис продлевает `expires_at`, а панель показывает «агент подтверждает с …».
ALTER TABLE commands
	ADD COLUMN started_at timestamptz,
	ADD COLUMN running_seen_at timestamptz;
