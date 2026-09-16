-- Phase 16 (1/2) — เพิ่ม ResourceKey ของ MJD Mobile Order
--
-- แยกไฟล์จาก backfill โดยตั้งใจ: PostgreSQL ห้ามใช้ค่า enum ที่เพิ่งเพิ่มในทรานแซคชันเดียวกับ ALTER TYPE ... ADD VALUE
-- ("unsafe use of new value") และ Prisma รันแต่ละ migration ในทรานแซคชันของตัวเอง → ไฟล์ถัดไปค่อยใช้ค่าใหม่ได้

ALTER TYPE "ResourceKey" ADD VALUE 'MO_TABLES';
ALTER TYPE "ResourceKey" ADD VALUE 'MO_KITCHEN';
ALTER TYPE "ResourceKey" ADD VALUE 'MO_NOTIFICATIONS';
ALTER TYPE "ResourceKey" ADD VALUE 'MO_MENU';
ALTER TYPE "ResourceKey" ADD VALUE 'MO_SETUP';
