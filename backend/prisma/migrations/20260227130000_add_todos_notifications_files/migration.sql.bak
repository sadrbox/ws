CREATE TABLE "todos" (
  "id" SERIAL PRIMARY KEY,
  "uuid" TEXT UNIQUE DEFAULT gen_random_uuid(),
  "shortName" TEXT,
  "description" TEXT,
  "organizationUuid" TEXT,
  "counterpartyUuid" TEXT,
  "curatorUuid" TEXT,
  "executorUuid" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "deadline" TIMESTAMP(3),
  "deadlineDays" INTEGER,
  "status" TEXT DEFAULT 'new',
  "ownerName" TEXT,
  CONSTRAINT "todos_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE
  SET
    NULL,
    CONSTRAINT "todos_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE
  SET
    NULL,
    CONSTRAINT "todos_curatorUuid_fkey" FOREIGN KEY ("curatorUuid") REFERENCES "users"("uuid") ON DELETE
  SET
    NULL,
    CONSTRAINT "todos_executorUuid_fkey" FOREIGN KEY ("executorUuid") REFERENCES "users"("uuid") ON DELETE
  SET
    NULL
);

CREATE TABLE "todo_files" (
  "id" SERIAL PRIMARY KEY,
  "uuid" TEXT UNIQUE DEFAULT gen_random_uuid(),
  "todoUuid" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "fileSize" INTEGER,
  "mimeType" TEXT,
  "uploadedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "todo_files_todoUuid_fkey" FOREIGN KEY ("todoUuid") REFERENCES "todos"("uuid") ON DELETE CASCADE
);

CREATE TABLE "notifications" (
  "id" SERIAL PRIMARY KEY,
  "uuid" TEXT UNIQUE DEFAULT gen_random_uuid(),
  "userUuid" TEXT NOT NULL,
  "todoUuid" TEXT,
  "title" TEXT NOT NULL,
  "message" TEXT,
  "isRead" BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE,
  CONSTRAINT "notifications_todoUuid_fkey" FOREIGN KEY ("todoUuid") REFERENCES "todos"("uuid") ON DELETE
  SET
    NULL
);

-- Индексы
CREATE INDEX "todos_organizationUuid_idx" ON "todos"("organizationUuid");

CREATE INDEX "todos_counterpartyUuid_idx" ON "todos"("counterpartyUuid");

CREATE INDEX "todos_curatorUuid_idx" ON "todos"("curatorUuid");

CREATE INDEX "todos_executorUuid_idx" ON "todos"("executorUuid");

CREATE INDEX "todos_status_idx" ON "todos"("status");

CREATE INDEX "todo_files_todoUuid_idx" ON "todo_files"("todoUuid");

CREATE INDEX "notifications_userUuid_idx" ON "notifications"("userUuid");

CREATE INDEX "notifications_todoUuid_idx" ON "notifications"("todoUuid");

CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");