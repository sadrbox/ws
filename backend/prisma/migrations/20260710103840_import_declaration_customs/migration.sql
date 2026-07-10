-- AlterTable
ALTER TABLE "import_declaration_items" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "import_declarations" ADD COLUMN     "customsFeeAmount" DECIMAL(18,2),
ADD COLUMN     "dutyAmount" DECIMAL(18,2),
ADD COLUMN     "exciseAmount" DECIMAL(18,2),
ADD COLUMN     "importVatAmount" DECIMAL(18,2);

