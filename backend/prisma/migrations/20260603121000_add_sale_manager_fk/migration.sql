-- FK менеджера реализации/возврата → employees (ON DELETE SET NULL).
ALTER TABLE "sales" ADD CONSTRAINT "sales_managerUuid_fkey" FOREIGN KEY ("managerUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_managerUuid_fkey" FOREIGN KEY ("managerUuid") REFERENCES "employees"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
