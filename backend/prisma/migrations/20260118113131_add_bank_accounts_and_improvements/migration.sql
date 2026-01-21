/*
  Warnings:

  - You are about to drop the `ActivityHistory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Contact` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ContactType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Contract` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Counterparty` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Organization` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ActivityHistory" DROP CONSTRAINT "ActivityHistory_organizationUuid_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_contactTypeUuid_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_counterpartyUuid_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_organizationUuid_fkey";

-- DropForeignKey
ALTER TABLE "Contract" DROP CONSTRAINT "Contract_counterpartyUuid_fkey";

-- DropForeignKey
ALTER TABLE "Contract" DROP CONSTRAINT "Contract_organizationUuid_fkey";

-- DropTable
DROP TABLE "ActivityHistory";

-- DropTable
DROP TABLE "Contact";

-- DropTable
DROP TABLE "ContactType";

-- DropTable
DROP TABLE "Contract";

-- DropTable
DROP TABLE "Counterparty";

-- DropTable
DROP TABLE "Organization";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "password" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "middleName" TEXT,
    "fullName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "bin" VARCHAR(12) NOT NULL,
    "shortName" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparties" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "bin" VARCHAR(12) NOT NULL,
    "shortName" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "contractNumber" TEXT,
    "contractText" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_types" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,

    CONSTRAINT "contact_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "contactTypeUuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "counterpartyUuid" TEXT,
    "iban" TEXT NOT NULL,
    "bik" TEXT,
    "bankName" TEXT,
    "currency" TEXT,
    "accountType" TEXT,
    "ownerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_history" (
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

    CONSTRAINT "activity_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_uuid_key" ON "organizations"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_bin_key" ON "organizations"("bin");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_uuid_key" ON "counterparties"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_bin_key" ON "counterparties"("bin");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_uuid_key" ON "contracts"("uuid");

-- CreateIndex
CREATE INDEX "contracts_organizationUuid_idx" ON "contracts"("organizationUuid");

-- CreateIndex
CREATE INDEX "contracts_counterpartyUuid_idx" ON "contracts"("counterpartyUuid");

-- CreateIndex
CREATE UNIQUE INDEX "contact_types_uuid_key" ON "contact_types"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "contact_types_shortName_key" ON "contact_types"("shortName");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_uuid_key" ON "contacts"("uuid");

-- CreateIndex
CREATE INDEX "contacts_contactTypeUuid_idx" ON "contacts"("contactTypeUuid");

-- CreateIndex
CREATE INDEX "contacts_organizationUuid_idx" ON "contacts"("organizationUuid");

-- CreateIndex
CREATE INDEX "contacts_counterpartyUuid_idx" ON "contacts"("counterpartyUuid");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_uuid_key" ON "bank_accounts"("uuid");

-- CreateIndex
CREATE INDEX "bank_accounts_organizationUuid_idx" ON "bank_accounts"("organizationUuid");

-- CreateIndex
CREATE INDEX "bank_accounts_counterpartyUuid_idx" ON "bank_accounts"("counterpartyUuid");

-- CreateIndex
CREATE INDEX "bank_accounts_iban_idx" ON "bank_accounts"("iban");

-- CreateIndex
CREATE INDEX "bank_accounts_bik_idx" ON "bank_accounts"("bik");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_organizationUuid_iban_key" ON "bank_accounts"("organizationUuid", "iban");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_counterpartyUuid_iban_key" ON "bank_accounts"("counterpartyUuid", "iban");

-- CreateIndex
CREATE UNIQUE INDEX "activity_history_uuid_key" ON "activity_history"("uuid");

-- CreateIndex
CREATE INDEX "activity_history_actionDate_idx" ON "activity_history"("actionDate");

-- CreateIndex
CREATE INDEX "activity_history_organizationUuid_idx" ON "activity_history"("organizationUuid");

-- CreateIndex
CREATE INDEX "activity_history_objectType_objectId_idx" ON "activity_history"("objectType", "objectId");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contactTypeUuid_fkey" FOREIGN KEY ("contactTypeUuid") REFERENCES "contact_types"("uuid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_counterpartyUuid_fkey" FOREIGN KEY ("counterpartyUuid") REFERENCES "counterparties"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_history" ADD CONSTRAINT "activity_history_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
