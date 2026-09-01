-- CreateEnum
CREATE TYPE "WaDirection" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "WaMsgStatus" AS ENUM ('received', 'queued', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "wa_channels" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'cloud',
    "providerAccountId" TEXT,
    "accessToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "wa_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wa_conversations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "channelUuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "displayName" TEXT,
    "contactPersonUuid" TEXT,
    "counterpartyUuid" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastIncomingAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "wa_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wa_messages" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "conversationUuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "direction" "WaDirection" NOT NULL,
    "body" TEXT,
    "mediaFileUuid" TEXT,
    "mediaType" TEXT,
    "authorUuid" TEXT,
    "providerMessageId" TEXT,
    "status" "WaMsgStatus" NOT NULL DEFAULT 'received',
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "wa_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wa_channels_uuid_key" ON "wa_channels"("uuid");

-- CreateIndex
CREATE INDEX "wa_channels_organizationUuid_idx" ON "wa_channels"("organizationUuid");

-- CreateIndex
CREATE INDEX "wa_channels_providerAccountId_idx" ON "wa_channels"("providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "wa_conversations_uuid_key" ON "wa_conversations"("uuid");

-- CreateIndex
CREATE INDEX "wa_conversations_organizationUuid_lastMessageAt_idx" ON "wa_conversations"("organizationUuid", "lastMessageAt");

-- CreateIndex
CREATE INDEX "wa_conversations_contactPersonUuid_idx" ON "wa_conversations"("contactPersonUuid");

-- CreateIndex
CREATE INDEX "wa_conversations_counterpartyUuid_idx" ON "wa_conversations"("counterpartyUuid");

-- CreateIndex
CREATE UNIQUE INDEX "wa_conversations_channelUuid_phone_key" ON "wa_conversations"("channelUuid", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "wa_messages_uuid_key" ON "wa_messages"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "wa_messages_providerMessageId_key" ON "wa_messages"("providerMessageId");

-- CreateIndex
CREATE INDEX "wa_messages_conversationUuid_createdAt_idx" ON "wa_messages"("conversationUuid", "createdAt");

