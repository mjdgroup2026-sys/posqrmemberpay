-- Phase 17b (1/2) — resource ใหม่ MO_POS (จอขายอาหารฝั่งพนักงาน)
--
-- ⚠️ ไฟล์นี้มีแค่ ALTER TYPE ... ADD VALUE เท่านั้น ห้ามใส่ SQL ที่ "ใช้" ค่าใหม่ลงไปด้วย
-- PostgreSQL ห้ามใช้ค่า enum ที่เพิ่งเพิ่มในทรานแซคชันเดียวกับที่เพิ่ม (Prisma ห่อทุก migration ด้วยทรานแซคชัน)
-- การ backfill สิทธิ์อยู่ในไฟล์ถัดไป

ALTER TYPE "ResourceKey" ADD VALUE IF NOT EXISTS 'MO_POS';
