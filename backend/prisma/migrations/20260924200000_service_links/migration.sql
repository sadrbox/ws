-- Обслуживающая организация и её клиенты (К1–К2 плана PLAN_INSTALL_MODES_2026-09-24.md).
--
-- ЗАЧЕМ. Консалтинговая компания ведёт бухучёт клиентов. Связь между ней и клиентом — ОТНОШЕНИЕ,
-- а не вложенность: иерархия «фирма — родитель клиентов» немедленно потребовала бы наследования
-- прав, модулей и настроек учёта вниз, а клиент, уходящий к другому бухгалтеру, должен уходить
-- без переноса данных.
--
-- ПОЧЕМУ ВРУЧНУЮ, А НЕ ПОЛНЫМ DIFF. `prisma migrate diff` против живой базы предлагает заодно
-- снести trgm- и partial-индексы (их Prisma не выражает) и переименовать ограничения, оставшиеся
-- от старых имён таблиц. Применить такой diff целиком — потерять поиск по классификаторам и
-- уникальность активных штрихкодов. Поэтому взяты только операторы, относящиеся к этой правке.
--
-- Доступ сотрудника фирмы к клиенту — назначение (service_assignments), а не копия членства
-- каждому: при 20 бухгалтерах и 200 клиентах это 4000 записей, и отзыв доступа уволенному
-- превратился бы в перебор двухсот организаций, где один пропуск — утечка чужого учёта.

-- Вид организации: "client" (обычная) | "service" (обслуживающая).
ALTER TABLE "organizations" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'client';

CREATE TABLE "service_links" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "serviceOrgUuid" TEXT NOT NULL,
    "clientOrgUuid" TEXT NOT NULL,
    -- requested → active → suspended/revoked. Отозванную связь НЕ удаляем: след «кто вёл учёт
    -- в таком-то году» нужен и клиенту, и при разборе.
    "state" TEXT NOT NULL DEFAULT 'requested',
    -- Кто и когда подтвердил СО СТОРОНЫ КЛИЕНТА: доступ к чужому учёту без следа недопустим.
    "confirmedByUuid" TEXT,
    "confirmedAt" TIMESTAMP(3),
    -- Срок договора: доступ прекращается сам, а не «когда вспомнят».
    "validUntil" TIMESTAMP(3),
    "profile" TEXT NOT NULL DEFAULT 'service_accountant',
    -- Ключи модулей клиента, открытые фирме; NULL — все установленные у клиента.
    "modules" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_assignments" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "linkUuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'lead',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_links_uuid_key" ON "service_links"("uuid");
CREATE INDEX "service_links_clientOrgUuid_idx" ON "service_links"("clientOrgUuid");
CREATE INDEX "service_links_state_idx" ON "service_links"("state");
-- Одна связь на пару «фирма → клиент»: повторный договор меняет состояние существующей.
CREATE UNIQUE INDEX "service_links_serviceOrgUuid_clientOrgUuid_key" ON "service_links"("serviceOrgUuid", "clientOrgUuid");

CREATE UNIQUE INDEX "service_assignments_uuid_key" ON "service_assignments"("uuid");
CREATE INDEX "service_assignments_userUuid_idx" ON "service_assignments"("userUuid");
CREATE UNIQUE INDEX "service_assignments_linkUuid_userUuid_key" ON "service_assignments"("linkUuid", "userUuid");

ALTER TABLE "service_links" ADD CONSTRAINT "service_links_serviceOrgUuid_fkey" FOREIGN KEY ("serviceOrgUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_links" ADD CONSTRAINT "service_links_clientOrgUuid_fkey" FOREIGN KEY ("clientOrgUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_assignments" ADD CONSTRAINT "service_assignments_linkUuid_fkey" FOREIGN KEY ("linkUuid") REFERENCES "service_links"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_assignments" ADD CONSTRAINT "service_assignments_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
