-- Ход обновления агента (задача агенту §2, выпуск агента 2026-09-20).
--
-- Агент сообщает его в heartbeat полем `update` (downloading | installing | restarting | failed | done) и
-- повторяет законченное сутки. Держим снимок как есть: это состояние службы, а не история.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS update_state jsonb;
