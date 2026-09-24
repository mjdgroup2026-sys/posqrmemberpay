-- 20g (2026-09-24): ปิดยอดแยกตามช่องทางชำระเงิน
--
-- 1) แยกพร้อมเพย์ออกจาก totalCard (เดิมรวมพร้อมเพย์ + บัตรไว้ในช่องเดียว)
-- 2) ยอดจริงที่แคชเชียร์กรอกเทียบของช่องทางอื่น — ไม่บังคับ (NULL = ไม่ได้กรอก)
--
-- ปิดรอบเก่า: คำนวณยอดพร้อมเพย์ใหม่จากบิลจริงของแคชเชียร์คนนั้นในวันนั้น (วันตามเวลาไทย) แล้วหักออกจาก totalCard เดิม
-- → totalCard + totalPromptPay ของแถวเก่าเท่ากับ totalCard เดิมทุกบาท (ผลรวมไม่เปลี่ยน)
-- void หลังปิดรอบทำไม่ได้ (voidSale เช็คปิดรอบตามวันของบิล) บิล COMPLETED ของวันนั้นจึงเป็นชุดเดียวกับตอนปิดรอบ
-- LEAST() กันกรณีผิดคาดไม่ให้ totalCard ติดลบ

ALTER TABLE "cashier_closing"
  ADD COLUMN "totalPromptPay"   DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "countedTransfer"  DECIMAL(12,2),
  ADD COLUMN "countedQR"        DECIMAL(12,2),
  ADD COLUMN "countedPromptPay" DECIMAL(12,2),
  ADD COLUMN "countedCard"      DECIMAL(12,2);

UPDATE "cashier_closing" c
SET "totalPromptPay" = LEAST(pp.total, c."totalCard"),
    "totalCard"      = c."totalCard" - LEAST(pp.total, c."totalCard")
FROM (
  SELECT s."storeId",
         s."cashierId",
         ((s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date AS day,
         SUM(s."total") AS total
  FROM "sale" s
  WHERE s."status" = 'COMPLETED' AND s."paymentMethod" = 'PROMPTPAY'
  GROUP BY 1, 2, 3
) pp
WHERE pp."storeId" = c."storeId"
  AND pp."cashierId" = c."cashierId"
  AND pp.day = c."closingDate";
