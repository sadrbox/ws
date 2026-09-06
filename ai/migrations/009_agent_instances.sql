-- Экземпляры агента: сколько ПРОЦЕССОВ работает под одним токеном (E15).
--
-- ЗАЧЕМ. Два запущенных экземпляра одного агента — невидимая с сервера авария: оба
-- разбирают одну очередь команд, и если их настройки разошлись (старый процесс с прежним
-- паролем кластера, новый — с исправленным), то одна и та же команда то проходит, то
-- падает. Со стороны это выглядит как «1С отвечает через раз», и ищут проблему где угодно,
-- только не во втором процессе.
--
-- Экземпляр называет себя сам (pid + время старта); мы лишь считаем, сколько их отзывалось
-- за последнее время.
CREATE TABLE agent_instances (
	agent_id      uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
	instance_id   text        NOT NULL,
	version       text,
	first_seen_at timestamptz NOT NULL DEFAULT now(),
	last_seen_at  timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (agent_id, instance_id)
);

CREATE INDEX agent_instances_seen_idx ON agent_instances (agent_id, last_seen_at DESC);
