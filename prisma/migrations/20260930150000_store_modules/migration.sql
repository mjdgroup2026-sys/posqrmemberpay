-- โมดูลต่อร้าน (2026-09-30) — ผู้ดูแลแพลตฟอร์มปิดโมดูลรายร้านได้ · additive ล้วน
-- ค่าเริ่มต้นเป็นรายการว่าง = ทุกร้าน (เดิมและใหม่) ได้ครบทุกโมดูลเหมือนก่อน deploy จึงไม่ต้อง backfill

-- CreateEnum
CREATE TYPE "StoreModule" AS ENUM ('SPA', 'INVENTORY', 'CRM', 'REPORTS');

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "disabledModules" "StoreModule"[] DEFAULT ARRAY[]::"StoreModule"[];
