-- CreateTable
CREATE TABLE "chat_messages" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "authorUuid" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_uuid_key" ON "chat_messages"("uuid");
-- CreateIndex
CREATE INDEX "chat_messages_organizationUuid_createdAt_idx" ON "chat_messages"("organizationUuid", "createdAt");
-- CreateIndex
CREATE INDEX "chat_messages_authorUuid_idx" ON "chat_messages"("authorUuid");
-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_authorUuid_fkey" FOREIGN KEY ("authorUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
