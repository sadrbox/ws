-- Обслуживание баз ПО РАСПИСАНИЮ (F2).
--
-- ЗАЧЕМ. Выгрузка и проверка баз запускались только руками: копия базы существовала ровно
-- тогда, когда о ней кто-то вспомнил. Ночное окно при этом единственное подходящее — днём
-- в базах работают, а выгрузка сотни баз занимает часы.
--
-- ЧТО ХРАНИМ. Что делать (тип команды), по каким базам, во сколько и в какие дни недели.
-- Расписание — НАСТРОЙКА, а его прогоны — обычные задания (command_batches): отдельного
-- журнала у расписания нет, и последний прогон хранится ссылкой на задание, чтобы итог по
-- каждой базе смотреть там же, где итоги ручных операций.
--
-- ВРЕМЯ — ЛОКАЛЬНОЕ ДЛЯ СЕРВЕРА. «Выгрузка в 02:00» означает два часа ночи там, где стоит
-- сервер 1С, а не UTC: человек назначает окно по своим сменам. Пересчёт в UTC сделал бы
-- расписание неверным дважды в год при переводе часов у клиентов, у которых он есть.
CREATE TABLE maintenance_schedules (
	id                 uuid PRIMARY KEY,
	organization_uuid  text NOT NULL,
	-- Кто создал; расписание переживает увольнение — поэтому без внешнего ключа.
	user_uuid          text,
	name               text NOT NULL,
	-- Тип команды 1С: IB_BACKUP (выгрузка) или IB_CHECK (проверка). Проверка списка — в
	-- сервисе (BATCHABLE), а не ограничением: список команд меняется чаще схемы.
	type               text NOT NULL,
	base_keys          text[] NOT NULL,
	-- Параметры команды: каталог выгрузки, флаги проверки. Пароли сюда не попадают.
	payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
	-- Когда запускать: время суток и дни недели (0 — воскресенье, как в JS getDay()).
	-- Пустой массив дней = каждый день: это чаще всего и нужно для ночной выгрузки.
	at_time            time NOT NULL,
	weekdays           smallint[] NOT NULL DEFAULT '{}',
	enabled            boolean NOT NULL DEFAULT true,
	-- Последний прогон: время и задание, в котором видно итог по каждой базе.
	last_run_at        timestamptz,
	last_batch_id      uuid,
	created_at         timestamptz NOT NULL DEFAULT now(),
	updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Отбор «что пора запускать» идёт по включённым расписаниям организации.
CREATE INDEX maintenance_schedules_due_idx ON maintenance_schedules (enabled, at_time);
CREATE INDEX maintenance_schedules_org_idx ON maintenance_schedules (organization_uuid);

COMMENT ON TABLE maintenance_schedules IS
	'Расписание обслуживания баз 1С: что, по каким базам, во сколько. Прогоны — в command_batches.';
COMMENT ON COLUMN maintenance_schedules.weekdays IS
	'Дни недели (0=вс). Пустой массив — каждый день.';
COMMENT ON COLUMN maintenance_schedules.at_time IS
	'Время запуска в локальной зоне сервиса: окно назначают по сменам, а не по UTC.';
