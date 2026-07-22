-- E3: составные индексы под горячие запросы (себестоимость/остатки, отчёты, списки).
CREATE INDEX "product_register_productUuid_warehouseUuid_date_idx" ON "product_register"("productUuid", "warehouseUuid", "date");
CREATE INDEX "accounting_entries_organizationUuid_date_idx" ON "accounting_entries"("organizationUuid", "date");
CREATE INDEX "sales_organizationUuid_id_idx" ON "sales"("organizationUuid", "id");
CREATE INDEX "purchases_organizationUuid_id_idx" ON "purchases"("organizationUuid", "id");
CREATE INDEX "cash_orders_organizationUuid_id_idx" ON "cash_orders"("organizationUuid", "id");
CREATE INDEX "bank_statements_organizationUuid_id_idx" ON "bank_statements"("organizationUuid", "id");
