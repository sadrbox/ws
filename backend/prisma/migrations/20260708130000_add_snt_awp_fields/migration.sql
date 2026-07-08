-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "sntErrorText" TEXT,
ADD COLUMN     "sntId" TEXT,
ADD COLUMN     "sntRegistrationNumber" TEXT,
ADD COLUMN     "sntSentAt" TIMESTAMP(3),
ADD COLUMN     "sntStatus" TEXT,
ADD COLUMN     "sntXml" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "tnvedCode" TEXT,
ADD COLUMN     "truOriginCode" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "awpErrorText" TEXT,
ADD COLUMN     "awpId" TEXT,
ADD COLUMN     "awpRegistrationNumber" TEXT,
ADD COLUMN     "awpSentAt" TIMESTAMP(3),
ADD COLUMN     "awpStatus" TEXT,
ADD COLUMN     "awpXml" TEXT,
ADD COLUMN     "sntErrorText" TEXT,
ADD COLUMN     "sntId" TEXT,
ADD COLUMN     "sntRegistrationNumber" TEXT,
ADD COLUMN     "sntSentAt" TIMESTAMP(3),
ADD COLUMN     "sntStatus" TEXT,
ADD COLUMN     "sntXml" TEXT;

