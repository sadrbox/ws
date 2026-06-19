-- DropColumn: разрядность номера (padding) больше не используется — номер
-- хранится и отображается без ведущих нулей.
ALTER TABLE "document_number_settings" DROP COLUMN "padding";
