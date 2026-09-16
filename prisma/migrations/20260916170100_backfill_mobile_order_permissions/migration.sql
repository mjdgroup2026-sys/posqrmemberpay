-- Phase 16 (2/2) — backfill สิทธิ์ MJD Mobile Order ให้บทบาทที่มีอยู่ + บทบาทใหม่ "พนักงานเสิร์ฟ"
--
-- ก่อน Phase 16 หน้า/action ของ Mobile Order ไม่ถูกคุมด้วย matrix สิทธิ์ — สมาชิกร้านทุกคนเข้าได้ (รวมคนที่ roleId = NULL)
-- พอเริ่มบังคับ ต้องไม่มีใคร "หลุด" ทันทีที่ deploy:
--   (1) บทบาทที่มีอยู่ทุกบทบาทได้สิทธิ์ MO ตามระดับ: ผู้ดูแลระบบ/ผู้จัดการร้าน/บทบาทที่ร้านสร้างเอง = เต็ม ·
--       แคชเชียร์ = ทำงานหน้าโต๊ะ/ครัว/แจ้งเตือนได้ ดูเมนู/จัดการโต๊ะได้อย่างเดียว (เจ้าของร้านปรับลดทีหลังได้ที่ /roles)
--   (2) สร้างบทบาท "พนักงานเสิร์ฟ" ให้ทุกร้าน (preset เดียวกับ lib/store-provision.ts) แล้วผูกให้ STAFF ที่ยังไม่มีบทบาท —
--       คนกลุ่มนี้เดิมใช้ได้แค่หน้า Mobile Order อยู่แล้ว (F1–F9 ถูกกันด้วย roleId NULL) จึงได้สิทธิ์เท่าเดิมพอดี
-- id ของบทบาทใหม่ใช้ md5(storeId) เพื่อให้ idempotent · ON CONFLICT DO NOTHING ทุกจุด รันซ้ำได้

-- (1) สิทธิ์ MO ให้บทบาทเดิม
INSERT INTO "role_permission" ("id", "roleId", "resource", "actions")
SELECT 'rp_' || md5(r."id" || ':' || x.resource), r."id", x.resource::"ResourceKey",
       CASE
         WHEN r."name" = 'แคชเชียร์' THEN x.cashier::"PermissionAction"[]
         ELSE x.allowed::"PermissionAction"[]
       END
FROM "role" r
CROSS JOIN (VALUES
  ('MO_TABLES',        ARRAY['VIEW','ADD','EDIT','DELETE'], ARRAY['VIEW','ADD','EDIT','DELETE']),
  ('MO_KITCHEN',       ARRAY['VIEW','EDIT'],                ARRAY['VIEW','EDIT']),
  ('MO_NOTIFICATIONS', ARRAY['VIEW','EDIT'],                ARRAY['VIEW','EDIT']),
  ('MO_MENU',          ARRAY['VIEW','ADD','EDIT','DELETE'], ARRAY['VIEW']),
  ('MO_SETUP',         ARRAY['VIEW','ADD','EDIT','DELETE'], ARRAY['VIEW'])
) AS x(resource, allowed, cashier)
ON CONFLICT ("roleId", "resource") DO NOTHING;

-- (2) บทบาท "พนักงานเสิร์ฟ" ทุกร้าน
INSERT INTO "role" ("id", "storeId", "name", "description", "isSystem", "createdAt", "updatedAt")
SELECT 'role_waiter_' || md5(s."id"), s."id", 'พนักงานเสิร์ฟ',
       'รับออเดอร์ เสิร์ฟ และปิดบิลโต๊ะได้ ไม่เห็นคลังสินค้าและ POS', false, now(), now()
FROM "store" s
ON CONFLICT ("storeId", "name") DO NOTHING;

INSERT INTO "role_permission" ("id", "roleId", "resource", "actions")
SELECT 'rp_' || md5(r."id" || ':' || x.resource), r."id", x.resource::"ResourceKey", x.actions::"PermissionAction"[]
FROM "role" r
CROSS JOIN (VALUES
  ('MO_TABLES',        ARRAY['VIEW','ADD','EDIT','DELETE']),
  ('MO_KITCHEN',       ARRAY['VIEW','EDIT']),
  ('MO_NOTIFICATIONS', ARRAY['VIEW','EDIT']),
  ('MO_MENU',          ARRAY['VIEW']),
  ('MO_SETUP',         ARRAY['VIEW'])
) AS x(resource, actions)
WHERE r."name" = 'พนักงานเสิร์ฟ'
ON CONFLICT ("roleId", "resource") DO NOTHING;

-- STAFF ที่ยังไม่มีบทบาท → พนักงานเสิร์ฟ ของร้านนั้น (OWNER ไม่ใช้ roleId)
UPDATE "store_member" m
SET "roleId" = r."id", "updatedAt" = now()
FROM "role" r
WHERE r."storeId" = m."storeId" AND r."name" = 'พนักงานเสิร์ฟ'
  AND m."role" = 'STAFF' AND m."roleId" IS NULL;
