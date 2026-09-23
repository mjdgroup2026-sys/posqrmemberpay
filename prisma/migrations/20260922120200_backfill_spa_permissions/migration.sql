-- Phase 20 (3/3) — backfill สิทธิ์ร้านนวดให้บทบาทเดิม (idempotent · ON CONFLICT DO NOTHING)
-- SPA_THERAPISTS ตาม MO_MENU (master data เหมือนเมนู) · SPA_BOOKINGS ตาม MO_TABLES (จอง/เช็กอิน = งานเดียวกับเปิดโต๊ะ)
-- ร้านที่ไม่เปิด spaEnabled ไม่เห็นเมนูเหล่านี้อยู่แล้ว การให้สิทธิ์ล่วงหน้าจึงไม่เปลี่ยนอะไรจนกว่าเจ้าของจะเปิดสวิตช์

INSERT INTO "role_permission" ("id", "roleId", "resource", "actions")
SELECT 'rp_' || md5(rp."roleId" || ':SPA_THERAPISTS'), rp."roleId", 'SPA_THERAPISTS'::"ResourceKey", rp."actions"
FROM "role_permission" rp
WHERE rp."resource" = 'MO_MENU' AND 'VIEW' = ANY(rp."actions")
ON CONFLICT ("roleId", "resource") DO NOTHING;

INSERT INTO "role_permission" ("id", "roleId", "resource", "actions")
SELECT 'rp_' || md5(rp."roleId" || ':SPA_BOOKINGS'), rp."roleId", 'SPA_BOOKINGS'::"ResourceKey", rp."actions"
FROM "role_permission" rp
WHERE rp."resource" = 'MO_TABLES' AND 'VIEW' = ANY(rp."actions")
ON CONFLICT ("roleId", "resource") DO NOTHING;
