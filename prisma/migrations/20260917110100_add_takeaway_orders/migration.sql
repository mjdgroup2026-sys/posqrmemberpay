-- Phase 17c (2/2) — ออร์เดอร์ครัวที่ไม่ผูกโต๊ะ (อาหารกลับบ้าน)
--
-- additive ล้วน + ผ่อนข้อบังคับเดิม: mobile_order."tableSessionId" เดิม NOT NULL (ทุกออร์เดอร์ผูกโต๊ะ)
-- ออร์เดอร์กลับบ้านไม่มีโต๊ะจึงต้อง DROP NOT NULL · แถวเดิมทั้งหมดยังมีค่าเหมือนเดิมและได้ orderType = DINE_IN
-- unique (tableSessionId, orderNumber) ยังใช้ได้ เพราะ PostgreSQL ไม่ถือว่า NULL ชนกัน

-- CreateEnum
CREATE TYPE "MobileOrderType" AS ENUM ('DINE_IN', 'TAKEAWAY');

-- AlterTable
ALTER TABLE "mobile_order"
  ADD COLUMN     "orderType" "MobileOrderType" NOT NULL DEFAULT 'DINE_IN',
  ADD COLUMN     "saleId" TEXT,
  ADD COLUMN     "customerLabel" TEXT,
  ALTER COLUMN "tableSessionId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "mobile_order_saleId_key" ON "mobile_order"("saleId");

-- AddForeignKey
ALTER TABLE "mobile_order" ADD CONSTRAINT "mobile_order_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
