-- Phase 14c — ร้านหลายสาขา (Brand) + ใบจ่ายค่าใช้งานรวม (SubscriptionBatch)
--
-- additive ทั้งไฟล์ — ไม่แตะแถวเดิม ไม่มี backfill: ร้านที่มีอยู่ทุกร้าน brandId = NULL (ร้านสาขาเดียว)
--   · ตาราง brand (เจ้าของ = user) · store.brandId (SET NULL เมื่อลบแบรนด์ — สาขาไม่หาย)
--   · ตาราง subscription_batch (หัวใบจ่ายรวม ถือ paymentReference แทนแถวลูก) · store_subscription.batchId
-- ร่างโดย `prisma migrate diff --from-config-datasource --to-schema` แล้วตรวจด้วยตา
-- ปิดท้ายต้องได้ `prisma migrate diff --exit-code` = No difference detected.

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "store_subscription" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_batch" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "requestRef" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_ownerId_idx" ON "brand"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_batch_requestRef_key" ON "subscription_batch"("requestRef");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_batch_paymentReference_key" ON "subscription_batch"("paymentReference");

-- CreateIndex
CREATE INDEX "subscription_batch_brandId_idx" ON "subscription_batch"("brandId");

-- CreateIndex
CREATE INDEX "subscription_batch_status_idx" ON "subscription_batch"("status");

-- CreateIndex
CREATE INDEX "store_brandId_idx" ON "store"("brandId");

-- CreateIndex
CREATE INDEX "store_subscription_batchId_idx" ON "store_subscription"("batchId");

-- AddForeignKey
ALTER TABLE "store" ADD CONSTRAINT "store_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand" ADD CONSTRAINT "brand_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscription" ADD CONSTRAINT "store_subscription_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "subscription_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_batch" ADD CONSTRAINT "subscription_batch_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

