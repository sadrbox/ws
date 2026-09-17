-- Сведения о сборке 1С-расширения esf_exchange в установках: водяной знак, версия,
-- режим лицензирования и хеш-сумма (приходят в heartbeat от модуля ТелеметрияЭСФ).
-- Только добавление nullable-колонок и индекса — существующие строки не меняются.
-- AlterTable
ALTER TABLE "esf_license_installs" ADD COLUMN     "buildHash" TEXT,
ADD COLUMN     "buildMode" TEXT,
ADD COLUMN     "buildVersion" TEXT,
ADD COLUMN     "buildWatermark" TEXT;

-- CreateIndex
CREATE INDEX "esf_license_installs_buildWatermark_idx" ON "esf_license_installs"("buildWatermark");
