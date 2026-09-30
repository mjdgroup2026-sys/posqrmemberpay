-- โลโก้แบรนด์ — สาขาที่ยังไม่ตั้งโลโก้ของตัวเองใช้โลโก้แบรนด์แทน
--
-- BrandAsset แยกจาก store_asset เพราะแบรนด์ไม่มี storeId · ผูกกับเจ้าของ (ownerId) เหมือน brand
-- additive ล้วน ไม่มี backfill ไม่แตะข้อมูลเดิม (แบรนด์เดิมทุกแบรนด์ logoUrl = NULL)

-- AlterTable
ALTER TABLE "brand" ADD COLUMN "logoUrl" TEXT;

-- CreateTable
CREATE TABLE "brand_asset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_asset_ownerId_idx" ON "brand_asset"("ownerId");

-- AddForeignKey
ALTER TABLE "brand_asset" ADD CONSTRAINT "brand_asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
