-- Переименование моделей прав доступа (чистка путаницы имён):
--   UserAccessRight (права по моделям)      → AccessPermission  → таблица access_permissions
--   UserSetting     (назначение организаций) → AccessRight       → таблица access_rights
--
-- RENAME, а не DROP+CREATE: prisma migrate diff видит переименование как «удалить+создать»
-- и снёс бы данные (выданные права и назначения). Здесь данные сохраняются.
-- Имена индексов/констрейнтов НЕ трогаем: Prisma по @@map смотрит только имя таблицы,
-- в рантайме имена индексов не важны (эти таблицы и так уже переименовывались ранее,
-- их констрейнты исторически называются иначе — и всё работает).
ALTER TABLE "user_settings" RENAME TO "access_rights";
ALTER TABLE "user_access_rights" RENAME TO "access_permissions";

-- Ключи прав хранятся строками в самой таблице разрешений. Модели переименованы —
-- переименовываем и ссылки на них, иначе выданные на эти модели права осиротеют.
UPDATE "access_permissions" SET "modelName" = 'AccessPermission' WHERE "modelName" = 'UserAccessRight';
UPDATE "access_permissions" SET "modelName" = 'AccessRight'      WHERE "modelName" = 'UserSetting';
