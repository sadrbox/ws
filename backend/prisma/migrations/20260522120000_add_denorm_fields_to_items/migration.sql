-- Денормализованные поля родительского документа на строках товаров.
-- Позволяют фильтровать строки напрямую без JOIN с родительской таблицей.

-- sale_items
ALTER TABLE "sale_items" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "sale_items" ADD COLUMN "posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sale_items" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "sale_items" ADD COLUMN "counterpartyUuid" TEXT;
CREATE INDEX "sale_items_date_idx" ON "sale_items"("date");
CREATE INDEX "sale_items_posted_idx" ON "sale_items"("posted");
CREATE INDEX "sale_items_organizationUuid_idx" ON "sale_items"("organizationUuid");
CREATE INDEX "sale_items_counterpartyUuid_idx" ON "sale_items"("counterpartyUuid");

-- purchase_items
ALTER TABLE "purchase_items" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "purchase_items" ADD COLUMN "posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_items" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "purchase_items" ADD COLUMN "counterpartyUuid" TEXT;
CREATE INDEX "purchase_items_date_idx" ON "purchase_items"("date");
CREATE INDEX "purchase_items_posted_idx" ON "purchase_items"("posted");
CREATE INDEX "purchase_items_organizationUuid_idx" ON "purchase_items"("organizationUuid");
CREATE INDEX "purchase_items_counterpartyUuid_idx" ON "purchase_items"("counterpartyUuid");

-- sale_return_items
ALTER TABLE "sale_return_items" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "sale_return_items" ADD COLUMN "posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sale_return_items" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "sale_return_items" ADD COLUMN "counterpartyUuid" TEXT;
CREATE INDEX "sale_return_items_date_idx" ON "sale_return_items"("date");
CREATE INDEX "sale_return_items_posted_idx" ON "sale_return_items"("posted");
CREATE INDEX "sale_return_items_organizationUuid_idx" ON "sale_return_items"("organizationUuid");
CREATE INDEX "sale_return_items_counterpartyUuid_idx" ON "sale_return_items"("counterpartyUuid");

-- purchase_return_items
ALTER TABLE "purchase_return_items" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "purchase_return_items" ADD COLUMN "posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_return_items" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "purchase_return_items" ADD COLUMN "counterpartyUuid" TEXT;
CREATE INDEX "purchase_return_items_date_idx" ON "purchase_return_items"("date");
CREATE INDEX "purchase_return_items_posted_idx" ON "purchase_return_items"("posted");
CREATE INDEX "purchase_return_items_organizationUuid_idx" ON "purchase_return_items"("organizationUuid");
CREATE INDEX "purchase_return_items_counterpartyUuid_idx" ON "purchase_return_items"("counterpartyUuid");

-- Заполнить существующие строки из родительских документов (backfill)
UPDATE "sale_items" si
SET "date" = s.date, "posted" = s.posted, "organizationUuid" = s."organizationUuid", "counterpartyUuid" = s."counterpartyUuid"
FROM "sales" s WHERE si."saleUuid" = s.uuid;

UPDATE "purchase_items" pi
SET "date" = p.date, "posted" = p.posted, "organizationUuid" = p."organizationUuid", "counterpartyUuid" = p."counterpartyUuid"
FROM "purchases" p WHERE pi."purchaseUuid" = p.uuid;

UPDATE "sale_return_items" sri
SET "date" = sr.date, "posted" = sr.posted, "organizationUuid" = sr."organizationUuid", "counterpartyUuid" = sr."counterpartyUuid"
FROM "sale_returns" sr WHERE sri."saleReturnUuid" = sr.uuid;

UPDATE "purchase_return_items" pri
SET "date" = pr.date, "posted" = pr.posted, "organizationUuid" = pr."organizationUuid", "counterpartyUuid" = pr."counterpartyUuid"
FROM "purchase_returns" pr WHERE pri."purchaseReturnUuid" = pr.uuid;
