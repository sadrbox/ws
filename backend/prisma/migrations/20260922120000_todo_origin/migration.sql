-- Происхождение задачи — отдельно от ссылки на объект (ПН1/СВ7 плана
-- docs/PLAN_TASKS_NOTES_PANEL_SERVICE_2026-09-22.md).
--
-- ЗАЧЕМ. Задачу из чата в 1С помечали `sourceType = '1c-chat'`, а подпись базы клали в
-- `sourceLabel` — то есть теми же полями, которыми задача ссылается на объект-источник
-- (реализацию, заметку, контрагента). Пока задача из 1С ни с чем не связана, это работало;
-- как только модель захотела связать задачу с созданным документом, метку происхождения
-- пришлось бы стереть. Поле одно, а смыслов два.
--
-- Теперь source* — только ссылка на объект, origin/originLabel — только происхождение.
-- Добавляются две nullable-колонки и индекс; существующие строки не меняются, кроме переноса
-- метки у задач из 1С: у них `sourceUuid` пуст, поэтому перенос однозначен и ничего не теряет.
ALTER TABLE "todos" ADD COLUMN "origin" TEXT,
                    ADD COLUMN "originLabel" TEXT;

CREATE INDEX "todos_origin_idx" ON "todos"("origin");

UPDATE "todos"
   SET "origin" = '1c-chat',
       "originLabel" = "sourceLabel",
       "sourceType" = NULL,
       "sourceLabel" = NULL
 WHERE "sourceType" = '1c-chat';
