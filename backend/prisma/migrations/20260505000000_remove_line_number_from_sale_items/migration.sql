-- AlterTable: remove lineNumber from sale_items (was used for ordering, replaced by id ordering on frontend)
ALTER TABLE "sale_items" DROP COLUMN IF EXISTS "lineNumber";
