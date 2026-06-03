-- Аналитика учёта по менеджеру реализации (НК РК): менеджер, по которому
-- учитывается движение продаж товаров и услуг. Необязательное субконто.
ALTER TABLE "sales" ADD COLUMN "managerUuid" TEXT;
ALTER TABLE "sale_returns" ADD COLUMN "managerUuid" TEXT;

CREATE INDEX "sales_managerUuid_idx" ON "sales"("managerUuid");
CREATE INDEX "sale_returns_managerUuid_idx" ON "sale_returns"("managerUuid");
