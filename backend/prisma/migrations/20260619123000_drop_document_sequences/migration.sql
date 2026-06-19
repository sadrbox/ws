-- DropTable: счётчики нумерации больше не используются — следующий номер
-- считается от фактических номеров журнала (services/documentNumbering.js).
DROP TABLE IF EXISTS "document_sequences";
