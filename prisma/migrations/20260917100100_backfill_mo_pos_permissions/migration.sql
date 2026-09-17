-- Phase 17b (2/2) — backfill สิทธิ์ MO_POS ให้บทบาทที่ "เปิดโต๊ะได้อยู่แล้ว"
--
-- จอขายอาหาร = การรับออเดอร์แทนลูกค้า ซึ่งเป็นงานเดียวกับที่บทบาทเหล่านี้ทำได้อยู่แล้วผ่านหน้าโต๊ะ
-- (MO_TABLES:ADD = เปิด/รวมโต๊ะ) จึงให้ VIEW+ADD ตามไปเลย ไม่ต้องให้เจ้าของร้านมาตั้งใหม่ทีละร้าน
-- บทบาทที่ดูได้อย่างเดียว (มีแค่ VIEW ของ MO_TABLES) ได้ VIEW อย่างเดียวเช่นกัน
-- id = md5 เพื่อให้ idempotent · ON CONFLICT DO NOTHING รันซ้ำได้

INSERT INTO "role_permission" ("id", "roleId", "resource", "actions")
SELECT 'rp_' || md5(rp."roleId" || ':MO_POS'), rp."roleId", 'MO_POS'::"ResourceKey",
       CASE
         WHEN 'ADD' = ANY(rp."actions") THEN ARRAY['VIEW','ADD']::"PermissionAction"[]
         ELSE ARRAY['VIEW']::"PermissionAction"[]
       END
FROM "role_permission" rp
WHERE rp."resource" = 'MO_TABLES'
  AND 'VIEW' = ANY(rp."actions")
ON CONFLICT ("roleId", "resource") DO NOTHING;
