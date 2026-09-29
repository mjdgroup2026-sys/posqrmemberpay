-- ปิดยอดได้หลายรอบต่อวัน (2026-09-29)
--
-- เดิม 1 แคชเชียร์ปิดได้ 1 ครั้ง/วัน และตัวเลขเป็น snapshot ตามช่วงเวลา — บิลที่ขายหลังปิดไม่ถูกนับในรอบใดเลย
-- ใหม่: บิลถูกผูกกับรอบที่นับมันแล้ว (sale.closingId) · รอบถัดไปนับเฉพาะบิลที่ยังไม่ถูกผูก

-- AlterTable
ALTER TABLE "cashier_closing" ADD COLUMN "roundNo" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sale" ADD COLUMN "closingId" TEXT;

-- เปลี่ยน unique จาก "วันละครั้ง" เป็น "วันละหลายรอบ"
DROP INDEX "cashier_closing_storeId_cashierId_closingDate_key";
CREATE UNIQUE INDEX "cashier_closing_storeId_cashierId_closingDate_roundNo_key" ON "cashier_closing"("storeId", "cashierId", "closingDate", "roundNo");

-- CreateIndex
CREATE INDEX "sale_closingId_idx" ON "sale"("closingId");

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "cashier_closing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: ผูกบิลเดิมกับการปิดยอดเดิม (ทุกแถวเดิม = รอบ 1)
-- เงื่อนไข: ร้าน + แคชเชียร์เดียวกัน · วันทางธุรกิจ (เวลาไทย) ตรงกับ closingDate · **ขายก่อนเวลาปิดยอด**
-- บิลที่ขายหลังปิดยอดเดิมไม่ถูกผูก → ขึ้นเป็น "ยังไม่ปิดรอบ" ให้ปิดเป็นรอบ 2 ได้ (เดิมไม่ถูกนับในรอบใดเลย)
-- createdAt/closedAt เก็บเป็น UTC แบบไม่มี timezone (เหมือน SALE_DAY_SQL ใน lib/queries.ts)
UPDATE "sale" s
SET "closingId" = c."id"
FROM "cashier_closing" c
WHERE s."storeId" = c."storeId"
  AND s."cashierId" = c."cashierId"
  AND s."status" IN ('COMPLETED', 'VOIDED')
  AND ((s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date = c."closingDate"
  AND s."createdAt" <= c."closedAt";
