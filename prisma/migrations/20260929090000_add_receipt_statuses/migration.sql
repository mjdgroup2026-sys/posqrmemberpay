-- Phase 21d (1/2) — สถานะใบรับแบบร่าง/รับหลายรอบ
-- แยกไฟล์ตามกติกาเดิม (PostgreSQL ห้าม ADD VALUE แล้วใช้ค่านั้นในทรานแซคชันเดียวกัน — ไฟล์ 2/2 ใช้ 'RECEIVED' ตอน backfill)
ALTER TYPE "StockDocStatus" ADD VALUE 'DRAFT';
ALTER TYPE "StockDocStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "StockDocStatus" ADD VALUE 'RECEIVED';
ALTER TYPE "StockDocStatus" ADD VALUE 'CLOSED';
