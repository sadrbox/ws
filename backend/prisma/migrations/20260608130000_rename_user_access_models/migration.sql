-- Переименование таблиц (данные сохраняются; индексы/constraints функционируют под старыми именами).
ALTER TABLE "user_permissions"          RENAME TO "user_settings";
ALTER TABLE "user_permission_defaults"  RENAME TO "user_defaults";
ALTER TABLE "access_rights"             RENAME TO "user_access_rights";
