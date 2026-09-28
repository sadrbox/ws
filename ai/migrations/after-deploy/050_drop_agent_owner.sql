-- ПОСЛЕ ВЫКЛАДКИ (docs/TASK_SERVICE_AGENT_OWNER_MODEL_2026-09-28.md, В1 и В8).
--
-- Загрузчик миграций читает только migrations/*.sql, эта папка ему не видна. Файл переносят в migrations/, когда
-- сборка без организации агента выложена и проверена: до этого откат кода встретил бы схему без колонок, которые
-- прежняя сборка читает. История одобрений заявок остаётся в журнале (audit_log).
ALTER TABLE agents DROP COLUMN IF EXISTS organization_uuid;
ALTER TABLE agents DROP COLUMN IF EXISTS max_bins;
ALTER TABLE agents DROP COLUMN IF EXISTS active_bins;
ALTER TABLE agent_enrollments DROP COLUMN IF EXISTS organization_uuid;
DROP TABLE IF EXISTS bin_activation_requests;
