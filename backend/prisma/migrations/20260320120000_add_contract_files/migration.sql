-- CreateTable: contract_files
CREATE TABLE IF NOT EXISTS "contract_files" (
  "id" SERIAL NOT NULL,
  "uuid" TEXT NOT NULL,
  "contractUuid" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "fileSize" INTEGER,
  "mimeType" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contract_files_uuid_key" ON "contract_files"("uuid");

CREATE INDEX IF NOT EXISTS "contract_files_contractUuid_idx" ON "contract_files"("contractUuid");

-- AddForeignKey
ALTER TABLE
  "contract_files"
ADD
  CONSTRAINT "contract_files_contractUuid_fkey" FOREIGN KEY ("contractUuid") REFERENCES "contracts"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;