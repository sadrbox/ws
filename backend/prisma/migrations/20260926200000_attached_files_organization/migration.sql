-- Аудит 26.09, исполнитель «backend-безопасность» (Б6): организация у вложенного файла.
--
-- Сгенерировано как diff схема↔схема (текущая schema.prisma с миграцией 20260926120000_audit_platform_indexes
-- → новая), а не с базы: полный diff с базы сносит частичные индексы уникальности штрихкодов
-- (памятка reference_schema_drift_migrations). Колонка без FK и допускает NULL: доступ к файлу
-- решает запись-владелец (api/router/files.js), колонка нужна выборкам.

-- AlterTable
ALTER TABLE "attached_files" ADD COLUMN IF NOT EXISTS "organizationUuid" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "attached_files_organizationUuid_idx" ON "attached_files"("organizationUuid");

-- Заполнение существующих строк по записи-владельцу (ownerType + ownerUuid). Строки, владельца
-- которых нет или который общий (организация NULL), остаются NULL — их доступ проверяется по владельцу.
-- Вид «global»: новый формат — ownerUuid = организация загрузившего; старый «global/global» — NULL.
UPDATE "attached_files" f SET "organizationUuid" = o."uuid"
	FROM "organizations" o
	WHERE f."ownerType" IN ('organization', 'global') AND o."uuid" = f."ownerUuid" AND f."organizationUuid" IS NULL;
UPDATE "attached_files" f SET "organizationUuid" = r."organizationUuid"
	FROM "counterparties" r
	WHERE f."ownerType" = 'counterparty' AND r."uuid" = f."ownerUuid" AND f."organizationUuid" IS NULL;
UPDATE "attached_files" f SET "organizationUuid" = r."organizationUuid"
	FROM "contracts" r
	WHERE f."ownerType" = 'contract' AND r."uuid" = f."ownerUuid" AND f."organizationUuid" IS NULL;
UPDATE "attached_files" f SET "organizationUuid" = r."organizationUuid"
	FROM "contact_persons" r
	WHERE f."ownerType" = 'contactperson' AND r."uuid" = f."ownerUuid" AND f."organizationUuid" IS NULL;
UPDATE "attached_files" f SET "organizationUuid" = r."organizationUuid"
	FROM "employees" r
	WHERE f."ownerType" = 'employee' AND r."uuid" = f."ownerUuid" AND f."organizationUuid" IS NULL;
UPDATE "attached_files" f SET "organizationUuid" = r."organizationUuid"
	FROM "products" r
	WHERE f."ownerType" = 'product' AND r."uuid" = f."ownerUuid" AND f."organizationUuid" IS NULL;
UPDATE "attached_files" f SET "organizationUuid" = r."organizationUuid"
	FROM "todos" r
	WHERE f."ownerType" = 'todo' AND r."uuid" = f."ownerUuid" AND f."organizationUuid" IS NULL;
-- Вложение ЭДО кладёт отправитель — организация файла его (получателю доступ даёт владелец-документ).
UPDATE "attached_files" f SET "organizationUuid" = r."senderOrgUuid"
	FROM "edo_documents" r
	WHERE f."ownerType" = 'edo_document' AND r."uuid" = f."ownerUuid" AND f."organizationUuid" IS NULL;
