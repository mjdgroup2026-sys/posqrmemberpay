-- Phase 17c (1/2) — ช่องทางขายใหม่ TAKEAWAY (อาหารกลับบ้านที่พนักงานกดขายเอง)
--
-- ⚠️ ไฟล์นี้มีแค่ ALTER TYPE ... ADD VALUE เท่านั้น — PostgreSQL ห้ามใช้ค่า enum ที่เพิ่งเพิ่ม
-- ในทรานแซคชันเดียวกับที่เพิ่ม (Prisma ห่อทุก migration ด้วยทรานแซคชัน)
--
-- แยกจาก MOBILE_ORDER โดยตั้งใจ: บิลของ MJD Mobile Order ต้องมี tableSessionId เสมอ (กติกาข้อ 8)
-- ส่วนบิลกลับบ้านไม่มีโต๊ะ และรายงานต้องแยกยอด "กลับบ้าน" ออกมาดูได้

ALTER TYPE "SaleChannel" ADD VALUE IF NOT EXISTS 'TAKEAWAY';
