-- Phase 20 (1/3) — เพิ่ม resource สิทธิ์ของร้านนวด
-- แยกไฟล์จากที่ใช้ค่าใหม่ เพราะ PostgreSQL ห้าม ADD VALUE แล้วใช้ค่านั้นในทรานแซคชันเดียวกัน (กับดักที่เคยพัง Phase 16)
ALTER TYPE "ResourceKey" ADD VALUE 'SPA_THERAPISTS';
ALTER TYPE "ResourceKey" ADD VALUE 'SPA_BOOKINGS';
