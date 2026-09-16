-- Phase 15a — ตั้งค่ารับเงินต่อร้าน (StorePaymentConfig + Store.paymentMode)
--
-- เขียนเองทั้งไฟล์เพราะมี "ย้ายคอลัมน์" store_settings.promptPayId → store_payment_config.promptPayId
-- Prisma ร่างให้เป็น DROP COLUMN เฉย ๆ (ข้อมูลเลขพร้อมเพย์ที่ร้านกรอกตอนรับสิทธิ์ทดลองจะหาย) — ลำดับที่ถูกคือ
--   (1) enum + คอลัมน์ใหม่ + ตารางใหม่  (2) backfill จากคอลัมน์เดิม  (3) ตั้งโหมดของร้านที่ต่อ SCB อยู่แล้ว  (4) ค่อย DROP คอลัมน์เดิม
-- ปิดท้ายต้องได้ `prisma migrate diff --exit-code` = No difference detected.

-- ───────────────────────── (1) schema ─────────────────────────

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('PROMPTPAY_DIRECT', 'PROMPTPAY_SLIP', 'SCB_BILLER');

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'PROMPTPAY_DIRECT';

-- CreateTable
CREATE TABLE "store_payment_config" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "promptPayId" TEXT,
    "accountName" TEXT,
    "bankAccountNumber" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "store_payment_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_payment_config_storeId_key" ON "store_payment_config"("storeId");

-- AddForeignKey
ALTER TABLE "store_payment_config" ADD CONSTRAINT "store_payment_config_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────── (2) backfill เลขพร้อมเพย์ที่ร้านกรอกไว้แล้ว (Phase 14b) ─────────────────────────
-- id ใช้ md5 ของ storeId เพื่อให้ idempotent/deterministic (ไม่ใช่ cuid แต่ Prisma ไม่บังคับรูปแบบ)

INSERT INTO "store_payment_config" ("id", "storeId", "promptPayId", "updatedAt", "updatedById")
SELECT 'spc_' || md5("storeId"), "storeId", "promptPayId", now(), "updatedById"
FROM "store_settings"
WHERE "promptPayId" IS NOT NULL
ON CONFLICT ("storeId") DO NOTHING;

-- ───────────────────────── (3) ร้านที่รับเงินผ่าน SCB Biller อยู่แล้ว ─────────────────────────
-- ก่อน Phase 15 การต่อ SCB เป็นระดับแพลตฟอร์ม (env) และมีร้านเดียวที่ใช้จริงคือร้านแรก (slug 'default' —
-- Biller ID ใน env เป็นของร้านนี้) · ร้านอื่นที่เกิดหลัง Phase 14a ต้องกลับไปเป็นพร้อมเพย์ตรงของตัวเอง
-- ไม่งั้นลูกค้าของร้านเหล่านั้นจะจ่ายเข้าบัญชี SCB ของร้าน default (บั๊กที่ 15a ปิด)

UPDATE "store" SET "paymentMode" = 'SCB_BILLER' WHERE "slug" = 'default';

-- ───────────────────────── (4) ทิ้งคอลัมน์เดิม ─────────────────────────

-- AlterTable
ALTER TABLE "store_settings" DROP COLUMN "promptPayId";
