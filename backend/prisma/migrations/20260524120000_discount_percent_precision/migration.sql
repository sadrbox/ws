-- AlterColumn: discountPercent Decimal(5,2) → Decimal(7,4)
-- Расширяет точность процента скидки с 2 до 4 знаков после запятой
-- (например, 8.9565%). Существующие данные сохраняются без потерь —
-- Decimal(7,4) является надмножеством Decimal(5,2).

ALTER TABLE "sale_items"             ALTER COLUMN "discountPercent" TYPE DECIMAL(7,4) USING "discountPercent"::DECIMAL(7,4);
ALTER TABLE "purchase_items"         ALTER COLUMN "discountPercent" TYPE DECIMAL(7,4) USING "discountPercent"::DECIMAL(7,4);
ALTER TABLE "outgoing_invoice_items" ALTER COLUMN "discountPercent" TYPE DECIMAL(7,4) USING "discountPercent"::DECIMAL(7,4);
ALTER TABLE "incoming_invoice_items" ALTER COLUMN "discountPercent" TYPE DECIMAL(7,4) USING "discountPercent"::DECIMAL(7,4);
ALTER TABLE "payment_invoice_items"  ALTER COLUMN "discountPercent" TYPE DECIMAL(7,4) USING "discountPercent"::DECIMAL(7,4);
ALTER TABLE "sale_return_items"      ALTER COLUMN "discountPercent" TYPE DECIMAL(7,4) USING "discountPercent"::DECIMAL(7,4);
ALTER TABLE "purchase_return_items"  ALTER COLUMN "discountPercent" TYPE DECIMAL(7,4) USING "discountPercent"::DECIMAL(7,4);
