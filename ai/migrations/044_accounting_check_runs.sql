-- Журнал ночных прогонов проверок учёта в базах клиентов (E17, СК2.2;
-- docs/PLAN_QUALITY_STANDARD_2026-09-25.md, docs/TASK_EXTENSION_ACCOUNTING_CHECKS_2026-09-25.md).
--
-- ЗАЧЕМ ТАБЛИЦА, ЕСЛИ НАХОДКИ ХРАНИТ ERP. У неё две работы, и обе — сервиса:
--   1) не дать второму ПЛАНОВОМУ прогону начаться в ту же ночь. Сервис перезапускают, и тик после перезапуска
--      не помнит, что прогон уже был; прогон по всем базам клиентов занимает их сеансы и лицензии часами, и
--      второй такой же в ту же ночь — это двойная нагрузка без единой новой находки. Уникальный индекс по дате
--      окна решает это атомарно: вставка плановой строки за ту же дату просто не проходит;
--   2) показать оператору, что было ночью: сколько баз и организаций, сколько команд и отказов, что пропущено и
--      почему (summary) — без чтения логов службы.
--
-- Строк — одна за ночь (плюс ручные запуски), поэтому срока хранения у журнала нет.
CREATE TABLE accounting_check_runs (
	id           uuid PRIMARY KEY,
	-- Дата окна запуска по часам сервера: прогон, начатый в 00:10 по окну 23:30, принадлежит прошлому дню.
	run_date     date NOT NULL,
	-- schedule — ночной по расписанию; manual — оператор из панели.
	kind         text NOT NULL,
	-- Кто запустил вручную; у планового пусто — это работа сервиса, а не человека.
	user_uuid    text,
	started_at   timestamptz NOT NULL DEFAULT now(),
	-- NULL — прогон идёт (или оборван перезапуском: такие при старте отмечаются прерванными).
	finished_at  timestamptz,
	bases        integer NOT NULL DEFAULT 0,
	orgs         integer NOT NULL DEFAULT 0,
	commands     integer NOT NULL DEFAULT 0,
	failures     integer NOT NULL DEFAULT 0,
	-- Итог по базам, пропущенное с причинами, итог отправки в ERP.
	summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
	note         text
);

-- Не больше одного планового прогона за дату окна (п. 1 выше).
CREATE UNIQUE INDEX accounting_check_runs_schedule_day ON accounting_check_runs (run_date) WHERE kind = 'schedule';
CREATE INDEX accounting_check_runs_started_idx ON accounting_check_runs (started_at DESC);

COMMENT ON TABLE accounting_check_runs IS
	'Журнал прогонов проверок учёта в базах 1С клиентов (E17). Находки и задачи по ним хранит ERP.';
