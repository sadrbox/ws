-- Add isService flag to products (false = товар, true = услуга)
ALTER TABLE "products" ADD COLUMN "isService" BOOLEAN NOT NULL DEFAULT false;
