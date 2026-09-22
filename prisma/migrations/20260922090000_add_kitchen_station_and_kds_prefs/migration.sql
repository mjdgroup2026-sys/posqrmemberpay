-- Phase 19 (2026-09-22) — ประเภทครัว (KitchenStation) + ค่าตั้งจอครัว (เสียงเตือน / พิมพ์ทิกเก็ตอัตโนมัติ)
-- additive ล้วน: ไม่มี backfill · ร้านเดิมทุกร้าน stationId = NULL, kitchenAlertSound = true, kitchenAutoPrint = false

-- AlterTable
ALTER TABLE "menu_item" ADD COLUMN     "stationId" TEXT;

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "kitchenAlertSound" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kitchenAutoPrint" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "kitchen_station" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_station_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kitchen_station_storeId_idx" ON "kitchen_station"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_station_storeId_name_key" ON "kitchen_station"("storeId", "name");

-- CreateIndex
CREATE INDEX "menu_item_stationId_idx" ON "menu_item"("stationId");

-- AddForeignKey
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "kitchen_station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_station" ADD CONSTRAINT "kitchen_station_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
