-- ─────────────────────────────────────────────────────────────────────────────
-- Чистка mock-данных перед генерацией проверочного набора (2026-07-20).
--
-- Архив снят до запуска: /mnt/ws/backups/buhprof_20260720_010617.dump
--
-- НЕПРИКОСНОВЕННОЕ (требование пользователя):
--   • Классификаторы РК (classifiers)      • Пользователи (users)
--   • События 1С (pipe_activity) И СВЯЗАННЫЕ С НИМИ данные
--   • Файлы (attached_files)               • План счетов (chart_of_accounts)
--   • Виды субконто (subkonto_types)
--
-- «Связанные с 1С» — не абстракция: события ссылаются на 197 товаров, 3 контрагентов
-- и 11 организаций через applyUuid/organizationUuid. Эти записи созданы интеграцией,
-- а не генератором, поэтому под «удали mock» не попадают. Множества защиты
-- материализуются ДО удаления — иначе, вычистив access_rights, мы потеряли бы
-- признак, по которому организация считается нужной.
--
-- Базовые справочники (единицы, валюты, налоги, типы цен, бренды, должности) не
-- трогаем: это не mock, а опора для остального; удаление дало бы только FK-риск.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- ── Множества защиты (материализуем до любых удалений) ───────────────────────
CREATE TEMP TABLE keep_products ON COMMIT DROP AS
SELECT p.uuid FROM products p
WHERE EXISTS (SELECT 1 FROM pipe_activity a WHERE a."applyUuid" = p.uuid);

CREATE TEMP TABLE keep_counterparties ON COMMIT DROP AS
SELECT c.uuid FROM counterparties c
WHERE EXISTS (SELECT 1 FROM pipe_activity a WHERE a."applyUuid" = c.uuid);

CREATE TEMP TABLE keep_orgs ON COMMIT DROP AS
SELECT o.uuid FROM organizations o
WHERE EXISTS (SELECT 1 FROM pipe_activity a WHERE a."organizationUuid" = o.uuid)
   OR EXISTS (SELECT 1 FROM access_rights s WHERE s."organizationUuid" = o.uuid)
   OR EXISTS (SELECT 1 FROM users u WHERE u."organizationUuid" = o.uuid);

-- ── 1. Бухгалтерия и регистры (зависят от документов — идут первыми) ─────────
DELETE FROM accounting_entry_analytics;
DELETE FROM accounting_entries;
DELETE FROM product_register;
DELETE FROM reservation_register;

-- ── 2. Строки документов ─────────────────────────────────────────────────────
DELETE FROM sale_items;                 DELETE FROM purchase_items;
DELETE FROM sale_return_items;          DELETE FROM purchase_return_items;
DELETE FROM outgoing_invoice_items;     DELETE FROM incoming_invoice_items;
DELETE FROM payment_invoice_items;      DELETE FROM purchase_requisition_items;
DELETE FROM purchase_order_items;       DELETE FROM sales_order_items;
DELETE FROM commercial_offer_items;     DELETE FROM reservation_items;
DELETE FROM inventory_transfer_items;   DELETE FROM write_off_items;
DELETE FROM goods_receipt_items;        DELETE FROM stock_count_items;
DELETE FROM import_declaration_items;

-- ── 3. Шапки документов ──────────────────────────────────────────────────────
DELETE FROM sales;                      DELETE FROM purchases;
DELETE FROM sale_returns;               DELETE FROM purchase_returns;
DELETE FROM outgoing_invoices;          DELETE FROM incoming_invoices;
DELETE FROM payment_invoices;           DELETE FROM purchase_requisitions;
DELETE FROM purchase_orders;            DELETE FROM sales_orders;
DELETE FROM commercial_offers;          DELETE FROM reservations;
DELETE FROM inventory_transfers;        DELETE FROM write_offs;
DELETE FROM goods_receipts;             DELETE FROM stock_counts;
DELETE FROM import_declarations;        DELETE FROM cash_orders;
DELETE FROM bank_statements;            DELETE FROM month_closes;
DELETE FROM payroll_calculations;       DELETE FROM payroll_payments;
DELETE FROM fiscal_receipts;            DELETE FROM edo_documents;
DELETE FROM edo_signatures;             DELETE FROM todos;

-- ── 4. Учёт по сериям/партиям и цены (пересоздадим mock'ом) ──────────────────
DELETE FROM serial_numbers;
DELETE FROM product_batches;
DELETE FROM product_prices;
DELETE FROM product_barcodes WHERE "productUuid" NOT IN (SELECT uuid FROM keep_products);

-- ── 5. Справочники под пересоздание ──────────────────────────────────────────
DELETE FROM contacts;
DELETE FROM contact_persons;
DELETE FROM contracts;
DELETE FROM bank_accounts;
DELETE FROM cashboxes;
DELETE FROM warehouses;
DELETE FROM employee_history;
DELETE FROM employees;

-- ── 6. Настройки, права, аудит ───────────────────────────────────────────────
DELETE FROM organization_accounting_settings;
DELETE FROM document_number_settings;
DELETE FROM user_defaults;
DELETE FROM access_permissions;
DELETE FROM access_rights;
DELETE FROM activity_history;

-- ── 7. Номенклатура и контрагенты — кроме пришедших из 1С ────────────────────
DELETE FROM products      WHERE uuid NOT IN (SELECT uuid FROM keep_products);
DELETE FROM counterparties WHERE uuid NOT IN (SELECT uuid FROM keep_counterparties);

-- ── 8. Организации — кроме связанных с 1С и пользователями ───────────────────
DELETE FROM organizations WHERE uuid NOT IN (SELECT uuid FROM keep_orgs);

-- ── Проверка перед фиксацией ─────────────────────────────────────────────────
SELECT 'события 1С (должно остаться 314)' AS "что", count(*) AS "сколько" FROM pipe_activity
UNION ALL SELECT 'товары от 1С (197)',        count(*) FROM products
UNION ALL SELECT 'контрагенты от 1С (3)',     count(*) FROM counterparties
UNION ALL SELECT 'организации (11)',          count(*) FROM organizations
UNION ALL SELECT 'пользователи (10)',         count(*) FROM users
UNION ALL SELECT 'классификаторы (38445)',    count(*) FROM classifiers
UNION ALL SELECT 'план счетов (18)',          count(*) FROM chart_of_accounts
UNION ALL SELECT 'виды субконто (11)',        count(*) FROM subkonto_types
UNION ALL SELECT 'файлы (24)',                count(*) FROM attached_files
UNION ALL SELECT 'документы: продажи (0)',    count(*) FROM sales
UNION ALL SELECT 'проводки (0)',              count(*) FROM accounting_entries;

-- Висячие ссылки событий 1С на удалённые объекты — должно быть 0.
SELECT count(*) AS "события 1С с оборванной ссылкой на товар"
FROM pipe_activity a
WHERE a."applyModel" = 'product' AND a."applyUuid" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.uuid = a."applyUuid");

COMMIT;
