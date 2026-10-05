-- ส่วนลดของบิลโต๊ะ (2026-10-05) — additive ล้วน ไม่มี backfill (บิลเดิมทุกใบ = ไม่มีส่วนลด)

-- CreateEnum
CREATE TYPE "BillDiscountMode" AS ENUM ('AMOUNT', 'PERCENT');

-- AlterTable
ALTER TABLE "table_session" ADD COLUMN     "discountMode" "BillDiscountMode",
ADD COLUMN     "discountNote" TEXT,
ADD COLUMN     "discountValue" DECIMAL(12,2);

-- ชนิดกับค่าต้องมาคู่กันเสมอ · ค่าไม่ติดลบ · % ไม่เกิน 100
ALTER TABLE "table_session" ADD CONSTRAINT "table_session_discount_check" CHECK (
  ("discountMode" IS NULL AND "discountValue" IS NULL)
  OR ("discountMode" IS NOT NULL AND "discountValue" IS NOT NULL AND "discountValue" > 0
      AND ("discountMode" <> 'PERCENT' OR "discountValue" <= 100))
);
