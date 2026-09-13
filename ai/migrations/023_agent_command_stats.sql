-- S5 (docs/TASKS_ONEC_FIXES_2026-09-13.md): отказы по кодам и время команд из heartbeat.
--
-- Агент шлёт в каждом heartbeat `failuresByCode` и `durationsByType` — снимок за время работы
-- его процесса (после перезапуска службы счёт заново). Раньше zod отбрасывал эти поля, и
-- «агент тормозит» мерили вручную. Хранится последний снимок у агента, как процессы (013):
-- это состояние, а не журнал. NULL — снимка не было (сборка агента старше 13.09 15:21).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS failures_by_code jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS durations_by_type jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS command_stats_seen_at timestamptz;
