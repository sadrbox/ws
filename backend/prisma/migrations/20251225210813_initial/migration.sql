-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "email" TEXT,
    "firstname" TEXT,
    "lastname" TEXT,
    "middlename" TEXT,
    "fullname" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT,
    "displayName" TEXT,
    "bin" VARCHAR(12) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counterparty" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT,
    "displayName" TEXT,
    "bin" VARCHAR(12) NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "contractNumber" TEXT,
    "contractText" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "contactTypeUuid" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactType" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,

    CONSTRAINT "ContactType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityHistory" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "actionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionType" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "organizationShortName" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "ip" TEXT,
    "city" TEXT,
    "objectId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "props" JSONB,

    CONSTRAINT "ActivityHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_uuid_key" ON "User"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_uuid_key" ON "Organization"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_bin_key" ON "Organization"("bin");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_uuid_key" ON "Counterparty"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_bin_key" ON "Counterparty"("bin");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_uuid_key" ON "Contract"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_uuid_key" ON "Contact"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "ContactType_uuid_key" ON "ContactType"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityHistory_uuid_key" ON "ActivityHistory"("uuid");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "Organization"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "Counterparty"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_contactTypeUuid_fkey" FOREIGN KEY ("contactTypeUuid") REFERENCES "ContactType"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "Organization"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "Counterparty"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityHistory" ADD CONSTRAINT "ActivityHistory_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "Organization"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
