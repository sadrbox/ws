-- DropForeignKey
ALTER TABLE "cash_expense_orders" DROP CONSTRAINT "cash_expense_orders_authorUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_expense_orders" DROP CONSTRAINT "cash_expense_orders_cashboxUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_expense_orders" DROP CONSTRAINT "cash_expense_orders_contractUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_expense_orders" DROP CONSTRAINT "cash_expense_orders_counterpartyUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_expense_orders" DROP CONSTRAINT "cash_expense_orders_organizationUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_receipt_orders" DROP CONSTRAINT "cash_receipt_orders_authorUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_receipt_orders" DROP CONSTRAINT "cash_receipt_orders_cashboxUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_receipt_orders" DROP CONSTRAINT "cash_receipt_orders_contractUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_receipt_orders" DROP CONSTRAINT "cash_receipt_orders_counterpartyUuid_fkey";
-- DropForeignKey
ALTER TABLE "cash_receipt_orders" DROP CONSTRAINT "cash_receipt_orders_organizationUuid_fkey";
-- DropTable
DROP TABLE "cash_expense_orders";
-- DropTable
DROP TABLE "cash_receipt_orders";
