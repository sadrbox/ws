-- Исправления аудита 26.09 (docs/AUDIT_2026-09-26.md: Б11, Н4, Н9, раздел 5 «Сервис ИИ»).
--
-- 1. ЗАЯВКИ АГЕНТОВ И БАЗ: повтор без секрета — новая заявка (Б11). Раньше повтор заявки с того же компьютера
--    и службы (или той же базы 1С) перезаписывал в ожидающей заявке секрет опроса и роль/список БИНов при
--    прежнем коде — и токен уходил тому, кто повторил последним. Теперь заявку меняет только предъявивший её
--    секрет, остальные получают новую заявку с новым кодом, поэтому «одна ожидающая заявка на службу» больше
--    не правило: уникальные индексы становятся обычными (по ним ищется повтор и закрываются соседи при одобрении).
DROP INDEX IF EXISTS agent_enrollments_host_pending_idx;
CREATE INDEX IF NOT EXISTS agent_enrollments_host_idx ON agent_enrollments (lower(computer), lower(service_name));
DROP INDEX IF EXISTS base_registrations_base_pending_idx;
CREATE INDEX IF NOT EXISTS base_registrations_base_idx ON base_registrations (onec_base_id);

-- 2. ОРГАНИЗАЦИИ БАЗЫ — ТОЛЬКО ОДОБРЕННЫЕ (Б11). `POST /v1/onec-chat/organizations` добавлял базе любой БИН без
--    одобрения, и по нему открывались задачи и заметки чужой организации. Теперь БИН из самой базы встаёт в
--    список ожидающим (approved_at IS NULL) и начинает действовать после одобрения: из одобренной заявки на
--    регистрацию, по совпадению с организацией токена базы или решением администратора BuhProf в панели.
ALTER TABLE base_organizations ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE base_organizations ADD COLUMN IF NOT EXISTS approved_by text;
-- Откуда БИН: registration — из одобренной заявки; token — организация токена базы; base — прислала сама база.
ALTER TABLE base_organizations ADD COLUMN IF NOT EXISTS source text;
-- Уже записанные строки считаются одобренными, только если их БИН был в ОДОБРЕННОЙ заявке этой базы: такие
-- видел оператор. Остальные (присланные самой базой) ждут решения — организацию токена база подтвердит сама
-- при следующем открытии чата. Канал задач и заметок до сих пор выключен (нет ERP_API_KEY), так что ожидание
-- ничего работающего не ломает.
UPDATE base_organizations o
   SET approved_at = o.created_at, approved_by = 'миграция 045', source = 'registration'
 WHERE o.approved_at IS NULL
   AND EXISTS (
        SELECT 1 FROM base_registrations r, jsonb_array_elements(COALESCE(r.body->'organizations', '[]'::jsonb)) x
         WHERE r.state = 'APPROVED' AND r.base_id::text = o.base_id AND trim(x->>'bin') = o.bin);
UPDATE base_organizations SET source = 'base' WHERE source IS NULL;
CREATE INDEX IF NOT EXISTS base_organizations_pending_idx ON base_organizations (created_at DESC) WHERE approved_at IS NULL;

-- 3. ОЧЕРЕДЬ КОМАНД (Н4, раздел 5). Просрочка теперь снимается по таймеру, а не только из опросов панели, и
--    UPDATE по всей таблице `commands` на каждый опрос заменяется запросом по живым командам — им нужен индекс.
CREATE INDEX IF NOT EXISTS commands_live_expires_idx ON commands (expires_at) WHERE state IN ('queued', 'dispatched');
-- Занятость места базы (OCCUPIES) смотрела всю историю агента: истёкшие и упавшие по TIMEOUT держат место
-- лишь недолго после завершения — выборка по времени завершения вместо полного прохода.
CREATE INDEX IF NOT EXISTS commands_agent_finished_idx ON commands (agent_id, finished_at) WHERE state IN ('expired', 'failed');

-- 4. ОСТАНОВЛЕННОЕ ЗАДАНИЕ НЕ ПОВТОРЯЕТСЯ (P3 отчёта очереди). «Остановить задание» отменяло только ещё не
--    выданные команды, а выданная, вернувшая «база занята», ставила свою копию в то же задание — и работа шла
--    дальше. Отметка остановки на задании — признак для retryBusy.
ALTER TABLE command_batches ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
