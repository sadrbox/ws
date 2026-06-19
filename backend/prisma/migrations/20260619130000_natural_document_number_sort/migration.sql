-- Document numbers are strings because they may contain a prefix. Use an ICU
-- numeric collation so ORDER BY keeps digit runs in human order:
-- 1, 2, 10 and РЕАЛ-1, РЕАЛ-2, РЕАЛ-10.
CREATE COLLATION IF NOT EXISTS "app_natural_numeric" (
    provider = icu,
    locale = 'und-u-kn-true'
);

ALTER TABLE "sales" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "purchases" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "outgoing_invoices" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "incoming_invoices" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "payment_invoices" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "inventory_transfers" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "cash_orders" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "month_closes" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "payroll_calculations" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "payroll_payments" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "sale_returns" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "purchase_returns" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "purchase_requisitions" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "commercial_offers" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "sales_orders" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "reservations" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "purchase_orders" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "bank_statements" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
ALTER TABLE "product_price_settings" ALTER COLUMN "number" TYPE TEXT COLLATE "app_natural_numeric";
