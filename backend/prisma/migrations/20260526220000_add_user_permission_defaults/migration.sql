CREATE TABLE "user_permission_defaults" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "valueUuid" TEXT NOT NULL,
    "valueName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_defaults_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_permission_defaults_uuid_key" ON "user_permission_defaults"("uuid");
CREATE UNIQUE INDEX "user_permission_defaults_userUuid_organizationUuid_valueType_key" ON "user_permission_defaults"("userUuid", "organizationUuid", "valueType");
CREATE INDEX "user_permission_defaults_userUuid_idx" ON "user_permission_defaults"("userUuid");
CREATE INDEX "user_permission_defaults_organizationUuid_idx" ON "user_permission_defaults"("organizationUuid");
CREATE INDEX "user_permission_defaults_updatedAt_idx" ON "user_permission_defaults"("updatedAt");

ALTER TABLE "user_permission_defaults" ADD CONSTRAINT "user_permission_defaults_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permission_defaults" ADD CONSTRAINT "user_permission_defaults_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
