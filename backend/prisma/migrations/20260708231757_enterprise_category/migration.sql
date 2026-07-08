-- Категория предприятия для ЭСФ: SellerType на организации, CustomerType на контрагенте.
ALTER TABLE "organizations" ADD COLUMN "enterpriseCategory" TEXT;
ALTER TABLE "counterparties" ADD COLUMN "enterpriseCategory" TEXT;
