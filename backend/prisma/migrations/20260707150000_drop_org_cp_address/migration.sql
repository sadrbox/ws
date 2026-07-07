-- Удаление поля address у organizations/counterparties: адрес берётся из
-- «Контактов» (contact.contactType='legal_address'), см. services/legalAddress.js.
ALTER TABLE "counterparties" DROP COLUMN "address";
ALTER TABLE "organizations" DROP COLUMN "address";
