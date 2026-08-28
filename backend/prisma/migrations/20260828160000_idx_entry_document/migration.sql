-- E3.3: индекс проводок по документу БЕЗ типа. Отчёты «продажи по товару»/ABC/
-- прибыль (api/router/reports.js) фильтруют accounting_entries по
-- documentUuid IN (...) без documentType — составной [documentType,documentUuid]
-- не применяется (нет левого префикса). Отдельный индекс закрывает эти запросы.
-- Только CREATE INDEX (посторонний дрейф полного диффа сюда НЕ включён).
-- На ОЧЕНЬ большой боевой таблице администратор может создать индекс вручную
-- через CREATE INDEX CONCURRENTLY (без блокировки записи); здесь — обычный
-- CREATE INDEX, как в остальных миграциях проекта.

-- CreateIndex
CREATE INDEX "accounting_entries_documentUuid_idx" ON "accounting_entries"("documentUuid");
