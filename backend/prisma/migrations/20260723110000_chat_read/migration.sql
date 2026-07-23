-- Отметка «прочитано до» в чате организации (E4.1). Одна строка на пару
-- пользователь+организация: непрочитанное считается как число сообщений
-- с createdAt > lastReadAt (свои сообщения не учитываются).
CREATE TABLE "chat_reads" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_reads_uuid_key" ON "chat_reads"("uuid");
CREATE UNIQUE INDEX "chat_reads_user_org_key" ON "chat_reads"("userUuid", "organizationUuid");
CREATE INDEX "chat_reads_userUuid_idx" ON "chat_reads"("userUuid");
