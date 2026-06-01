CREATE TABLE "reservation_register" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "productUuid" TEXT,
    "warehouseUuid" TEXT,
    "organizationUuid" TEXT,
    "reservationUuid" TEXT NOT NULL,
    "reservationItemUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_register_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservation_register_uuid_key" ON "reservation_register"("uuid");

-- CreateIndex
CREATE INDEX "reservation_register_productUuid_warehouseUuid_idx" ON "reservation_register"("productUuid", "warehouseUuid");

-- CreateIndex
CREATE INDEX "reservation_register_reservationUuid_idx" ON "reservation_register"("reservationUuid");

-- CreateIndex
CREATE INDEX "reservation_register_organizationUuid_idx" ON "reservation_register"("organizationUuid");

-- AddForeignKey
ALTER TABLE "reservation_register" ADD CONSTRAINT "reservation_register_productUuid_fkey" FOREIGN KEY ("productUuid") REFERENCES "products"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_register" ADD CONSTRAINT "reservation_register_warehouseUuid_fkey" FOREIGN KEY ("warehouseUuid") REFERENCES "warehouses"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_register" ADD CONSTRAINT "reservation_register_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

