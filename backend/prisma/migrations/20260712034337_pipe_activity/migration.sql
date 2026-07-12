-- CreateTable
CREATE TABLE "pipe_activity" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionType" TEXT NOT NULL,
    "organizationShortName" TEXT,
    "bin" TEXT,
    "userName" TEXT NOT NULL,
    "host" TEXT,
    "ip" TEXT,
    "objectId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "props" JSONB,
    "payload" JSONB,

    CONSTRAINT "pipe_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipe_activity_uuid_key" ON "pipe_activity"("uuid");

-- CreateIndex
CREATE INDEX "pipe_activity_receivedAt_idx" ON "pipe_activity"("receivedAt");

-- CreateIndex
CREATE INDEX "pipe_activity_objectType_objectId_idx" ON "pipe_activity"("objectType", "objectId");
