

-- AlterTable
ALTER TABLE "user_access_rights" RENAME CONSTRAINT "access_rights_pkey" TO "user_access_rights_pkey";

-- AlterTable
ALTER TABLE "user_defaults" RENAME CONSTRAINT "user_permission_defaults_pkey" TO "user_defaults_pkey";

-- AlterTable
ALTER TABLE "user_settings" RENAME CONSTRAINT "user_permissions_pkey" TO "user_settings_pkey";

-- RenameForeignKey
ALTER TABLE "user_access_rights" RENAME CONSTRAINT "access_rights_organizationUuid_fkey" TO "user_access_rights_organizationUuid_fkey";

-- RenameForeignKey
ALTER TABLE "user_access_rights" RENAME CONSTRAINT "access_rights_userUuid_fkey" TO "user_access_rights_userUuid_fkey";

-- RenameForeignKey
ALTER TABLE "user_defaults" RENAME CONSTRAINT "user_permission_defaults_organizationUuid_fkey" TO "user_defaults_organizationUuid_fkey";

-- RenameForeignKey
ALTER TABLE "user_defaults" RENAME CONSTRAINT "user_permission_defaults_userUuid_fkey" TO "user_defaults_userUuid_fkey";

-- RenameForeignKey
ALTER TABLE "user_settings" RENAME CONSTRAINT "user_permissions_organizationUuid_fkey" TO "user_settings_organizationUuid_fkey";

-- RenameForeignKey
ALTER TABLE "user_settings" RENAME CONSTRAINT "user_permissions_userUuid_fkey" TO "user_settings_userUuid_fkey";

-- RenameIndex
ALTER INDEX "access_rights_organizationUuid_idx" RENAME TO "user_access_rights_organizationUuid_idx";

-- RenameIndex
ALTER INDEX "access_rights_updatedAt_idx" RENAME TO "user_access_rights_updatedAt_idx";

-- RenameIndex
ALTER INDEX "access_rights_userUuid_idx" RENAME TO "user_access_rights_userUuid_idx";

-- RenameIndex
ALTER INDEX "access_rights_userUuid_organizationUuid_modelName_key" RENAME TO "user_access_rights_userUuid_organizationUuid_modelName_key";

-- RenameIndex
ALTER INDEX "access_rights_uuid_key" RENAME TO "user_access_rights_uuid_key";

-- RenameIndex
ALTER INDEX "user_permission_defaults_organizationUuid_idx" RENAME TO "user_defaults_organizationUuid_idx";

-- RenameIndex
ALTER INDEX "user_permission_defaults_updatedAt_idx" RENAME TO "user_defaults_updatedAt_idx";

-- RenameIndex
ALTER INDEX "user_permission_defaults_userUuid_idx" RENAME TO "user_defaults_userUuid_idx";

-- RenameIndex
ALTER INDEX "user_permission_defaults_userUuid_organizationUuid_valueTyp_key" RENAME TO "user_defaults_userUuid_organizationUuid_valueType_key";

-- RenameIndex
ALTER INDEX "user_permission_defaults_uuid_key" RENAME TO "user_defaults_uuid_key";

-- RenameIndex
ALTER INDEX "user_permissions_organizationUuid_idx" RENAME TO "user_settings_organizationUuid_idx";

-- RenameIndex
ALTER INDEX "user_permissions_updatedAt_idx" RENAME TO "user_settings_updatedAt_idx";

-- RenameIndex
ALTER INDEX "user_permissions_userUuid_idx" RENAME TO "user_settings_userUuid_idx";

-- RenameIndex
ALTER INDEX "user_permissions_userUuid_organizationUuid_key" RENAME TO "user_settings_userUuid_organizationUuid_key";

-- RenameIndex
ALTER INDEX "user_permissions_uuid_key" RENAME TO "user_settings_uuid_key";

