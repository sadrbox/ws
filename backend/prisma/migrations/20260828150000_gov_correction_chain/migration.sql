-- T7.11: корректировочные цепочки СНТ/ЭАВР. Поля-ссылки на основной документ
-- (аналог OutgoingInvoice.esfRelatedInvoiceUuid для ЭСФ). Только ADD COLUMN —
-- посторонний дрейф полного диффа (DROP INDEX штрихкод/trigram) сюда НЕ включён.

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "awpRelatedUuid" TEXT,
ADD COLUMN     "sntRelatedUuid" TEXT;

-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "sntRelatedUuid" TEXT;
