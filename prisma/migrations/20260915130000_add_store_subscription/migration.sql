-- Phase 14b — ค่าใช้งานแบบต่ออายุ (Store Subscription)
--
-- เขียนเองทั้งไฟล์: ส่วน (1) เป็น additive ให้ Prisma ร่างแล้วตรวจด้วยตา · ส่วน (2)–(3) เป็นข้อมูล
--   (1) enum + คอลัมน์บน store/store_settings + ตาราง subscription_plan / store_subscription / trial_claim
--   (2) seed แพ็กเกจมาตรฐาน version 1 (24 ใบ + TRIAL) — ตัวเลขมาจาก lib/subscription.ts ผ่าน prisma/gen-plan-seed-sql.ts
--   (3) backfill ร้านที่มีอยู่ก่อนระบบค่าใช้งาน → แถว CUSTOM/FREE ถึง 2099-12-31 + tableLimit 120 (XL)
--       เพื่อไม่ให้ร้านที่ใช้งานอยู่ถูกล็อก "ขายไม่ได้" ทันทีที่ deploy · ร้านใหม่หลังจากนี้เริ่มที่ planExpiresAt NULL
--
-- ปิดท้ายต้องได้ `prisma migrate diff --exit-code` = No difference detected.

-- ───────────────────────── (1) schema ─────────────────────────

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('S', 'M', 'L', 'XL');

-- CreateEnum
CREATE TYPE "SubscriptionKind" AS ENUM ('RENEWAL', 'UPGRADE', 'TRIAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('TRANSFER', 'PROMPTPAY', 'FREE');

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "expiryNoticeLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "planExpiresAt" TIMESTAMP(3),
ADD COLUMN     "planTier" "PlanTier",
ADD COLUMN     "tableLimit" INTEGER NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "promptPayId" TEXT;

-- CreateTable
CREATE TABLE "subscription_plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "tableLimit" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "ratePerDay" DECIMAL(8,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "subscription_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_subscription" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "planId" TEXT,
    "kind" "SubscriptionKind" NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "tableLimit" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "ratePerDay" DECIMAL(8,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "listPrice" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "SubscriptionPaymentMethod" NOT NULL,
    "requestRef" TEXT NOT NULL,
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "reversesId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_claim" (
    "id" TEXT NOT NULL,
    "promptPayIdHash" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_supersededById_key" ON "subscription_plan"("supersededById");

-- CreateIndex
CREATE INDEX "subscription_plan_isActive_idx" ON "subscription_plan"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_code_version_key" ON "subscription_plan"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "store_subscription_requestRef_key" ON "store_subscription"("requestRef");

-- CreateIndex
CREATE UNIQUE INDEX "store_subscription_paymentReference_key" ON "store_subscription"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "store_subscription_reversesId_key" ON "store_subscription"("reversesId");

-- CreateIndex
CREATE INDEX "store_subscription_storeId_idx" ON "store_subscription"("storeId");

-- CreateIndex
CREATE INDEX "store_subscription_status_idx" ON "store_subscription"("status");

-- CreateIndex
CREATE INDEX "store_subscription_periodEnd_idx" ON "store_subscription"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "trial_claim_promptPayIdHash_key" ON "trial_claim"("promptPayIdHash");

-- AddForeignKey
ALTER TABLE "subscription_plan" ADD CONSTRAINT "subscription_plan_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "subscription_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscription" ADD CONSTRAINT "store_subscription_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscription" ADD CONSTRAINT "store_subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_subscription" ADD CONSTRAINT "store_subscription_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "store_subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───────────────────────── (2) แพ็กเกจมาตรฐาน version 1 ─────────────────────────
-- ราคาสุทธิตั้งตรง ๆ ตามตารางใน Docs/spec.md (ไม่คำนวณจาก ratePerDay × days) · append-only: แก้ราคา = version ใหม่

INSERT INTO "subscription_plan"
    ("id", "code", "version", "name", "tier", "tableLimit", "durationDays", "ratePerDay", "discountPercent", "price", "sortOrder")
VALUES
    ('plan_s_d7_v1', 'S-D7', 1, 'S · 7 วัน', 'S', 12, 7, 10.00, 0.00, 70.00, 0),
    ('plan_s_d15_v1', 'S-D15', 1, 'S · 15 วัน', 'S', 12, 15, 10.00, 3.33, 145.00, 1),
    ('plan_s_d30_v1', 'S-D30', 1, 'S · 30 วัน', 'S', 12, 30, 10.00, 6.67, 280.00, 2),
    ('plan_s_m3_v1', 'S-M3', 1, 'S · 3 เดือน', 'S', 12, 90, 10.00, 11.11, 800.00, 3),
    ('plan_s_m6_v1', 'S-M6', 1, 'S · 6 เดือน', 'S', 12, 180, 10.00, 16.67, 1500.00, 4),
    ('plan_s_m12_v1', 'S-M12', 1, 'S · 1 ปี', 'S', 12, 365, 10.00, 23.29, 2800.00, 5),
    ('plan_m_d7_v1', 'M-D7', 1, 'M · 7 วัน', 'M', 30, 7, 20.00, 0.00, 140.00, 10),
    ('plan_m_d15_v1', 'M-D15', 1, 'M · 15 วัน', 'M', 30, 15, 20.00, 3.33, 290.00, 11),
    ('plan_m_d30_v1', 'M-D30', 1, 'M · 30 วัน', 'M', 30, 30, 20.00, 6.67, 560.00, 12),
    ('plan_m_m3_v1', 'M-M3', 1, 'M · 3 เดือน', 'M', 30, 90, 20.00, 11.11, 1600.00, 13),
    ('plan_m_m6_v1', 'M-M6', 1, 'M · 6 เดือน', 'M', 30, 180, 20.00, 16.67, 3000.00, 14),
    ('plan_m_m12_v1', 'M-M12', 1, 'M · 1 ปี', 'M', 30, 365, 20.00, 23.29, 5600.00, 15),
    ('plan_l_d7_v1', 'L-D7', 1, 'L · 7 วัน', 'L', 60, 7, 35.00, 0.00, 245.00, 20),
    ('plan_l_d15_v1', 'L-D15', 1, 'L · 15 วัน', 'L', 60, 15, 35.00, 3.81, 505.00, 21),
    ('plan_l_d30_v1', 'L-D30', 1, 'L · 30 วัน', 'L', 60, 30, 35.00, 6.67, 980.00, 22),
    ('plan_l_m3_v1', 'L-M3', 1, 'L · 3 เดือน', 'L', 60, 90, 35.00, 11.11, 2800.00, 23),
    ('plan_l_m6_v1', 'L-M6', 1, 'L · 6 เดือน', 'L', 60, 180, 35.00, 16.67, 5250.00, 24),
    ('plan_l_m12_v1', 'L-M12', 1, 'L · 1 ปี', 'L', 60, 365, 35.00, 23.29, 9800.00, 25),
    ('plan_xl_d7_v1', 'XL-D7', 1, 'XL · 7 วัน', 'XL', 120, 7, 60.00, 0.00, 420.00, 30),
    ('plan_xl_d15_v1', 'XL-D15', 1, 'XL · 15 วัน', 'XL', 120, 15, 60.00, 3.33, 870.00, 31),
    ('plan_xl_d30_v1', 'XL-D30', 1, 'XL · 30 วัน', 'XL', 120, 30, 60.00, 6.67, 1680.00, 32),
    ('plan_xl_m3_v1', 'XL-M3', 1, 'XL · 3 เดือน', 'XL', 120, 90, 60.00, 11.11, 4800.00, 33),
    ('plan_xl_m6_v1', 'XL-M6', 1, 'XL · 6 เดือน', 'XL', 120, 180, 60.00, 16.67, 9000.00, 34),
    ('plan_xl_m12_v1', 'XL-M12', 1, 'XL · 1 ปี', 'XL', 120, 365, 60.00, 23.29, 16800.00, 35),
    ('plan_trial_v1', 'TRIAL', 1, 'ทดลองใช้ 7 วัน', 'S', 12, 7, 0.00, 0.00, 0.00, 99)
;

-- ───────────────────────── (3) ร้านที่มีอยู่ก่อน → ฟรีตลอด (ledger อธิบายได้) ─────────────────────────

INSERT INTO "store_subscription"
    ("id", "storeId", "planId", "kind", "tier", "tableLimit", "days", "ratePerDay", "discountPercent", "listPrice", "amount",
     "periodStart", "periodEnd", "status", "paymentMethod", "requestRef", "paidAt", "note", "createdAt")
SELECT
    'sub_legacy_' || s."id",
    s."id",
    NULL,
    'CUSTOM',
    'XL',
    120,
    0,
    0.00,
    0.00,
    0.00,
    0.00,
    CURRENT_TIMESTAMP,
    '2099-12-31 00:00:00',
    'PAID',
    'FREE',
    'SUB-LEGACY' || LPAD((ROW_NUMBER() OVER (ORDER BY s."createdAt"))::text, 4, '0'),
    CURRENT_TIMESTAMP,
    'ร้านเดิมก่อนระบบค่าใช้งาน (backfill ตอน migrate Phase 14b)',
    CURRENT_TIMESTAMP
FROM "store" s;

UPDATE "store"
SET "planTier" = 'XL', "tableLimit" = 120, "planExpiresAt" = '2099-12-31 00:00:00'
WHERE "planExpiresAt" IS NULL;
