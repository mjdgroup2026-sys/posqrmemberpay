-- Phase 17a — รูปภาพที่ร้านอัปโหลดเอง (StoreAsset)
--
-- เก็บไบต์รูปลงฐานข้อมูลโดยตั้งใจ: VPS รัน blue/green คนละคอนเทนเนอร์และไม่มี volume
-- ไฟล์ที่เขียนลงดิสก์จึงหายทุกรอบ deploy · รูปถูกย่อในเบราว์เซอร์ให้ ≤ 300KB ก่อนอัปโหลดเสมอ
-- additive ล้วน ไม่มี backfill ไม่แตะข้อมูลเดิม

-- CreateTable
CREATE TABLE "store_asset" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_asset_storeId_idx" ON "store_asset"("storeId");

-- AddForeignKey
ALTER TABLE "store_asset" ADD CONSTRAINT "store_asset_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_asset" ADD CONSTRAINT "store_asset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
