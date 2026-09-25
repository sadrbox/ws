-- E17: производственный календарь РК и признак «Отмена» у статуса задачи (решения 25.09).
--
-- ЗАЧЕМ. Сроки стандарта (SLA обращений, отработка находок, проверка исправления, посещаемость)
-- считаются в РАБОЧЕМ времени: обращение в пятницу вечером не становится нарушением в субботу, а
-- праздник — прогулом. Календарь заполнен по Закону «О праздниках в РК» на 2026–2027 годы тем же кодом,
-- что работает в сервисе (services/quality/workTime.js → computeRkCalendar): праздники + перенос
-- выходного, совпавшего с государственным праздником; религиозные — без переноса. Дополнительные
-- переносы по постановлению Правительства и дату Курбан айта 2027 вносит администратор.
--
-- Признак isCancel: отмена — финальный статус без результата; признак, а не код, чтобы свой статус
-- отмены с другим кодом работал так же.

-- AlterTable
ALTER TABLE "todo_statuses" ADD COLUMN     "isCancel" BOOLEAN NOT NULL DEFAULT false;
UPDATE "todo_statuses" SET "isCancel" = true WHERE "code" IN ('cancelled', 'canceled', 'cancel') AND "isFinal" = true;

-- CreateTable
CREATE TABLE "work_calendar_days" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_calendar_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_calendar_days_uuid_key" ON "work_calendar_days"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "work_calendar_days_date_key" ON "work_calendar_days"("date");

-- Календарь РК 2026–2027 по закону.
INSERT INTO "work_calendar_days" ("uuid", "date", "kind", "name", "source", "updatedAt") VALUES
    (gen_random_uuid(), '2026-01-01', 'holiday', 'Новый год', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-01-02', 'holiday', 'Новый год', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-01-07', 'holiday', 'Православное Рождество', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-03-08', 'holiday', 'Международный женский день', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-03-09', 'dayoff', 'Перенос выходного: Международный женский день (2026-03-08)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-03-21', 'holiday', 'Наурыз мейрамы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-03-22', 'holiday', 'Наурыз мейрамы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-03-23', 'holiday', 'Наурыз мейрамы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-03-24', 'dayoff', 'Перенос выходного: Наурыз мейрамы (2026-03-21)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-03-25', 'dayoff', 'Перенос выходного: Наурыз мейрамы (2026-03-22)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-05-01', 'holiday', 'Праздник единства народа Казахстана', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-05-07', 'holiday', 'День защитника Отечества', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-05-09', 'holiday', 'День Победы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-05-11', 'dayoff', 'Перенос выходного: День Победы (2026-05-09)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-05-27', 'holiday', 'Курбан айт', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-07-06', 'holiday', 'День Столицы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-08-30', 'holiday', 'День Конституции', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-08-31', 'dayoff', 'Перенос выходного: День Конституции (2026-08-30)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-10-25', 'holiday', 'День Республики', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-10-26', 'dayoff', 'Перенос выходного: День Республики (2026-10-25)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2026-12-16', 'holiday', 'День Независимости', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-01-01', 'holiday', 'Новый год', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-01-02', 'holiday', 'Новый год', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-01-04', 'dayoff', 'Перенос выходного: Новый год (2027-01-02)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-01-07', 'holiday', 'Православное Рождество', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-03-08', 'holiday', 'Международный женский день', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-03-21', 'holiday', 'Наурыз мейрамы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-03-22', 'holiday', 'Наурыз мейрамы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-03-23', 'holiday', 'Наурыз мейрамы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-03-24', 'dayoff', 'Перенос выходного: Наурыз мейрамы (2027-03-21)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-05-01', 'holiday', 'Праздник единства народа Казахстана', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-05-03', 'dayoff', 'Перенос выходного: Праздник единства народа Казахстана (2027-05-01)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-05-07', 'holiday', 'День защитника Отечества', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-05-09', 'holiday', 'День Победы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-05-10', 'dayoff', 'Перенос выходного: День Победы (2027-05-09)', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-07-06', 'holiday', 'День Столицы', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-08-30', 'holiday', 'День Конституции', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-10-25', 'holiday', 'День Республики', 'seed', CURRENT_TIMESTAMP),
    (gen_random_uuid(), '2027-12-16', 'holiday', 'День Независимости', 'seed', CURRENT_TIMESTAMP)
ON CONFLICT ("date") DO NOTHING;
