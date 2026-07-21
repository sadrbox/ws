-- Поиск по классификаторам (ТН ВЭД / КАТО / ГСВС, ~38 тыс. строк) — ILIKE '%…%'
-- по коду и наименованию (listClassifiers → Prisma contains). B-tree его не
-- ускоряет: селективный запрос сканирует весь тип (замерено: name ILIKE '%…%' на
-- tnved — 280 мс). pg_trgm + GIN делают подстрочный поиск индексируемым.
-- Тот же паттерн, что products_*_trgm (миграция product_search_trgm_indexes).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "classifiers_name_trgm" ON "classifiers" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "classifiers_code_trgm" ON "classifiers" USING GIN ("code" gin_trgm_ops);
