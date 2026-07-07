-- CreateTable
CREATE TABLE "classifiers" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentCode" TEXT,
    "extra" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "classifiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "classifiers_uuid_key" ON "classifiers"("uuid");

-- CreateIndex
CREATE INDEX "classifiers_type_idx" ON "classifiers"("type");

-- CreateIndex
CREATE INDEX "classifiers_type_parentCode_idx" ON "classifiers"("type", "parentCode");

-- CreateIndex
CREATE UNIQUE INDEX "classifiers_type_code_key" ON "classifiers"("type", "code");

