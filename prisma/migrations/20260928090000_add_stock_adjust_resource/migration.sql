-- Phase 21 (1/2) — resource สิทธิ์ใหม่ "ปรับยอดสต็อก"
-- แยกไฟล์จากที่อื่นตามกติกาเดิม (PostgreSQL ห้าม ADD VALUE แล้วใช้ค่านั้นในทรานแซคชันเดียวกัน)
-- ตั้งใจไม่ backfill ให้บทบาทใด — หลัง deploy มีแค่ OWNER ที่ปรับยอดได้ จนกว่าเจ้าของจะติ๊กให้ใน /roles
ALTER TYPE "ResourceKey" ADD VALUE 'STOCK_ADJUST';
