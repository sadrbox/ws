-- Add denormalized date/posted/organizationUuid/counterpartyUuid to item tables
-- that use _documentItemsFactory but were missing these fields.

ALTER TABLE "outgoing_invoice_items" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "outgoing_invoice_items" ADD COLUMN "posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "outgoing_invoice_items" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "outgoing_invoice_items" ADD COLUMN "counterpartyUuid" TEXT;
CREATE INDEX "outgoing_invoice_items_date_idx" ON "outgoing_invoice_items"("date");
CREATE INDEX "outgoing_invoice_items_posted_idx" ON "outgoing_invoice_items"("posted");
CREATE INDEX "outgoing_invoice_items_organizationUuid_idx" ON "outgoing_invoice_items"("organizationUuid");
CREATE INDEX "outgoing_invoice_items_counterpartyUuid_idx" ON "outgoing_invoice_items"("counterpartyUuid");

ALTER TABLE "incoming_invoice_items" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "incoming_invoice_items" ADD COLUMN "posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "incoming_invoice_items" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "incoming_invoice_items" ADD COLUMN "counterpartyUuid" TEXT;
CREATE INDEX "incoming_invoice_items_date_idx" ON "incoming_invoice_items"("date");
CREATE INDEX "incoming_invoice_items_posted_idx" ON "incoming_invoice_items"("posted");
CREATE INDEX "incoming_invoice_items_organizationUuid_idx" ON "incoming_invoice_items"("organizationUuid");
CREATE INDEX "incoming_invoice_items_counterpartyUuid_idx" ON "incoming_invoice_items"("counterpartyUuid");

ALTER TABLE "payment_invoice_items" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "payment_invoice_items" ADD COLUMN "posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payment_invoice_items" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "payment_invoice_items" ADD COLUMN "counterpartyUuid" TEXT;
CREATE INDEX "payment_invoice_items_date_idx" ON "payment_invoice_items"("date");
CREATE INDEX "payment_invoice_items_posted_idx" ON "payment_invoice_items"("posted");
CREATE INDEX "payment_invoice_items_organizationUuid_idx" ON "payment_invoice_items"("organizationUuid");
CREATE INDEX "payment_invoice_items_counterpartyUuid_idx" ON "payment_invoice_items"("counterpartyUuid");

ALTER TABLE "purchase_requisition_items" ADD COLUMN "date" TIMESTAMP(3);
ALTER TABLE "purchase_requisition_items" ADD COLUMN "posted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_requisition_items" ADD COLUMN "organizationUuid" TEXT;
ALTER TABLE "purchase_requisition_items" ADD COLUMN "counterpartyUuid" TEXT;
CREATE INDEX "purchase_requisition_items_date_idx" ON "purchase_requisition_items"("date");
CREATE INDEX "purchase_requisition_items_posted_idx" ON "purchase_requisition_items"("posted");
CREATE INDEX "purchase_requisition_items_organizationUuid_idx" ON "purchase_requisition_items"("organizationUuid");
CREATE INDEX "purchase_requisition_items_counterpartyUuid_idx" ON "purchase_requisition_items"("counterpartyUuid");
