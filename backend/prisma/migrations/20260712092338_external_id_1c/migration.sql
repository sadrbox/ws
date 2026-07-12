-- Идентификатор элемента во внешней системе (1С) — ключ сопоставления при приёме /pipe.
-- Без него повторное событие по тому же элементу создавало бы дубль, а переименование
-- в 1С — ещё один. Пара (externalSource, externalId) уникальна; NULL-ы в Postgres
-- считаются различными, поэтому существующие записи (обе колонки NULL) не конфликтуют.
ALTER TABLE "organizations"      ADD COLUMN "externalId" TEXT, ADD COLUMN "externalSource" TEXT;
ALTER TABLE "counterparties"     ADD COLUMN "externalId" TEXT, ADD COLUMN "externalSource" TEXT;
ALTER TABLE "products"           ADD COLUMN "externalId" TEXT, ADD COLUMN "externalSource" TEXT;
ALTER TABLE "warehouses"         ADD COLUMN "externalId" TEXT, ADD COLUMN "externalSource" TEXT;
ALTER TABLE "units_of_measure"   ADD COLUMN "externalId" TEXT, ADD COLUMN "externalSource" TEXT;

CREATE UNIQUE INDEX "organizations_externalSource_externalId_key"    ON "organizations"("externalSource","externalId");
CREATE UNIQUE INDEX "counterparties_externalSource_externalId_key"   ON "counterparties"("externalSource","externalId");
CREATE UNIQUE INDEX "products_externalSource_externalId_key"         ON "products"("externalSource","externalId");
CREATE UNIQUE INDEX "warehouses_externalSource_externalId_key"       ON "warehouses"("externalSource","externalId");
CREATE UNIQUE INDEX "units_of_measure_externalSource_externalId_key" ON "units_of_measure"("externalSource","externalId");

-- Результат применения входящего события к справочнику (виден во «Входящих 1С»).
ALTER TABLE "pipe_activity"
  ADD COLUMN "applyStatus"  TEXT,
  ADD COLUMN "applyModel"   TEXT,
  ADD COLUMN "applyUuid"    TEXT,
  ADD COLUMN "applyMessage" TEXT;
