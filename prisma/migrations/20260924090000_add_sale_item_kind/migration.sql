-- 20e (2026-09-24): จำประเภทบรรทัดลงบิล เพื่อแยกรายงาน อาหาร / นวดสปา / สินค้าหน้าร้าน
--
-- เดิมต้อง join MenuItem ปัจจุบันเพื่อรู้ว่าเป็นอาหารหรือนวด — ลบเมนู (menuItemId ถูก SetNull) หรือเปลี่ยนชนิดทีหลัง
-- รายงานย้อนหลังจะเพี้ยน จึง snapshot ลงบิลเหมือน name/unitPrice
--
-- ลำดับ: สร้าง TYPE → เพิ่มคอลัมน์แบบ nullable → เติมค่าบิลเก่า → ตั้ง NOT NULL (ไม่มี DEFAULT โดยตั้งใจ ทุกทางออกบิลต้องระบุเอง)
-- CREATE TYPE ใช้ในทรานแซคชันเดียวกันได้ (ข้อห้ามของ PostgreSQL มีเฉพาะ ALTER TYPE … ADD VALUE)

CREATE TYPE "SaleLineKind" AS ENUM ('PRODUCT', 'FOOD', 'SERVICE');

ALTER TABLE "sale_item" ADD COLUMN "kind" "SaleLineKind";

-- สินค้าหน้าร้าน = บรรทัดที่อ้าง product
UPDATE "sale_item" SET "kind" = 'PRODUCT' WHERE "productId" IS NOT NULL;

-- นวด = มีพนักงานนวดติดบรรทัด หรือเมนูเป็นโปรแกรมนวด
UPDATE "sale_item" si
SET "kind" = 'SERVICE'
WHERE si."kind" IS NULL
  AND (
    si."therapistId" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "menu_item" m WHERE m."id" = si."menuItemId" AND m."itemType" = 'SERVICE')
  );

-- ที่เหลือ (เมนูอาหาร รวมบรรทัดที่เมนูถูกลบไปแล้ว) = อาหาร
UPDATE "sale_item" SET "kind" = 'FOOD' WHERE "kind" IS NULL;

ALTER TABLE "sale_item" ALTER COLUMN "kind" SET NOT NULL;
