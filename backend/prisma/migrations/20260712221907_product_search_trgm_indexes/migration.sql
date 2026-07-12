-- Поиск в списке Номенклатуры — ILIKE '%…%' (подстрока). B-tree его не ускоряет:
-- на 1M товаров это полный проход таблицы (замерено: 741 мс по имени, 2.3 с со штрих-кодами).
-- pg_trgm + GIN делают подстрочный поиск индексируемым (те же запросы: <1 мс / 3.8 мс).
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- CreateIndex
CREATE INDEX "products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_sku_trgm" ON "products" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_barcode_trgm" ON "products" USING GIN ("barcode" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "product_barcodes_barcode_trgm" ON "product_barcodes" USING GIN ("barcode" gin_trgm_ops);

