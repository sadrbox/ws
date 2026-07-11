-- AlterTable
ALTER TABLE "goods_receipt_items" ADD COLUMN     "batchUuid" TEXT;

-- AlterTable
ALTER TABLE "import_declaration_items" ADD COLUMN     "batchUuid" TEXT;

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "batchUuid" TEXT;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "batchUuid" TEXT;

-- AlterTable
ALTER TABLE "write_off_items" ADD COLUMN     "batchUuid" TEXT;

