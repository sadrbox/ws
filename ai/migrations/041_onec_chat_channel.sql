-- Канал «расширение 1С ↔ сервис»: идемпотентность хода и тихая смена токена базы
-- (docs/TASK_SERVICE_ONEC_CHAT_CHANNEL_2026-09-21.md, §2 и §3).

-- ХОД, О КОТОРОМ НЕИЗВЕСТНО, ДОШЁЛ ЛИ ОН. Оборванный ответ не говорит ничего: расширение показывает
-- «нет связи», человек пишет заново — и если первый ход всё-таки дошёл, в диалоге два одинаковых
-- сообщения, а модель отвечает дважды и дважды берёт деньги. Ключ рождается в 1С один раз на круг,
-- поэтому сверять тела не нужно: тот же ключ — тот же ход.
--
-- Ключ живёт в пределах пары «база + пользователь ИБ»: ключи разных клиентов не должны встречаться.
-- Строка хранит и ОТВЕТ: повтор получает ровно то, что получил бы первый запрос, а не «уже сделано».
CREATE TABLE onec_chat_turn_keys (
    base_id          uuid NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
    user_id          text NOT NULL,
    key              text NOT NULL,
    state            text NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'done')),
    conversation_id  uuid,
    status           integer,
    response         jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    PRIMARY KEY (base_id, user_id, key)
);
CREATE INDEX onec_chat_turn_keys_expires_idx ON onec_chat_turn_keys (expires_at);

-- ТИХАЯ СМЕНА ТОКЕНА БАЗЫ. Токен живёт до отзыва, то есть годами; менять его вручную — идти к каждому
-- клиенту, поэтому никто не меняет. Сервис кладёт новый токен в ответ обычного хода и какое-то время
-- принимает оба: расширение сохраняет новый само, человек не делает ничего.
--
--   rotate_after   — когда токену пора смениться; NULL у токенов, которые не ротируем;
--   replaced_by    — преемник (строка того же клиента), у преемника этого поля нет;
--   accepted_until — до какого мига принимается ПРЕЖНИЙ токен (перекрытие);
--   pending_secret — преемник в закрытом виде (aes-256-gcm, ключ из секрета сервиса): нужен, чтобы
--                    отдать ТОТ ЖЕ новый токен ещё раз, если ответ с ним не дошёл. Стирается, как
--                    только преемником воспользовались;
--   first_used_at  — первый успешный запрос этим токеном: он и подтверждает доставку.
ALTER TABLE base_tokens ADD COLUMN rotate_after   timestamptz;
ALTER TABLE base_tokens ADD COLUMN replaced_by    uuid REFERENCES base_tokens(id) ON DELETE SET NULL;
ALTER TABLE base_tokens ADD COLUMN accepted_until timestamptz;
ALTER TABLE base_tokens ADD COLUMN pending_secret text;
ALTER TABLE base_tokens ADD COLUMN first_used_at  timestamptz;

-- Уже выданным токенам — тот же срок, что и новым: 90 дней от выпуска. Смена всё равно произойдёт
-- только у базы с расширением, которое умеет её принять (проверяется по X-Ext-Version).
UPDATE base_tokens SET rotate_after = created_at + interval '90 days' WHERE revoked_at IS NULL;
