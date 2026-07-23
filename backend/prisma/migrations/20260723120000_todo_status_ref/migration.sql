-- Справочник статусов задач (E9.5): вместо хардкод-enum в UI.
-- code хранится в todos.status — существующие задачи продолжают работать.
CREATE TABLE "todo_statuses" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "todo_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "todo_statuses_uuid_key" ON "todo_statuses"("uuid");
CREATE UNIQUE INDEX "todo_statuses_code_key" ON "todo_statuses"("code");

-- Засеваем ровно те статусы, что были захардкожены, с теми же кодами —
-- иначе существующие задачи остались бы без подписи статуса.
INSERT INTO "todo_statuses" ("uuid", "code", "name", "sortOrder", "isFinal", "updatedAt") VALUES
  (gen_random_uuid(), 'new',         'Новая',     10, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'in_progress', 'В работе',  20, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'done',        'Выполнена', 30, true,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'cancelled',   'Отменена',  40, true,  CURRENT_TIMESTAMP);
