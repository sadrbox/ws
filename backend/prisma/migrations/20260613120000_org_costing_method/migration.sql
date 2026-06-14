-- AlterTable: метод расчёта себестоимости организации (AVERAGE | FIFO)
ALTER TABLE "organization_accounting_settings" ADD COLUMN "costingMethod" TEXT NOT NULL DEFAULT 'AVERAGE';
