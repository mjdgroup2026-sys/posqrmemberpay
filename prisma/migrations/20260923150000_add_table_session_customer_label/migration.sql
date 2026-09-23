-- ร้านสปา: 1 ลูกค้า = 1 บิล (2026-09-23) — ห้องนวดเดียวเปิดได้หลาย session พร้อมกัน แต่ละใบมีชื่อลูกค้า
-- additive ล้วน: คอลัมน์ nullable ไม่มี default ไม่มี backfill (session เดิมทั้งหมด = null = พฤติกรรมเดิม)
ALTER TABLE "table_session" ADD COLUMN "customerLabel" TEXT;
