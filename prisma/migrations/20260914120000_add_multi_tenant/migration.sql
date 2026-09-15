-- Phase 13 — Multi-tenant: Store + StoreMember + storeId บนทุกตารางราก
--
-- เขียนเองทั้งไฟล์ (ห้ามให้ Prisma generate) เพราะทุกตารางมีข้อมูลอยู่แล้ว:
-- ADD COLUMN ... NOT NULL ตรง ๆ จะล้มทันทีที่ตารางไม่ว่าง จึงต้อง
--   (1) สร้างร้าน "default" จาก store_settings เดิม
--   (2) เพิ่ม store_id แบบ nullable → backfill ทุกแถวด้วยร้านนั้น → SET NOT NULL
--   (3) เปลี่ยน unique เดิมเป็นต่อร้าน
--   (4) ย้าย user.roleId → store_member.roleId และทำให้ผู้ใช้เดิมทุกคนอยู่ในร้าน default
--
-- ชื่อ constraint/index ทุกตัวต้องตรงกับที่ Prisma คาด (ดูจาก `prisma migrate diff`)
-- ปิดท้ายต้องได้ `prisma migrate diff --exit-code` = No difference detected.

-- ───────────────────────── enum + ตารางใหม่ ─────────────────────────

CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "StoreRole" AS ENUM ('OWNER', 'STAFF');

CREATE TABLE "store" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_slug_key" ON "store"("slug");

CREATE TABLE "store_member" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "role" "StoreRole" NOT NULL DEFAULT 'STAFF',
    "roleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_member_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "store_member_storeId_idx" ON "store_member"("storeId");
CREATE INDEX "store_member_roleId_idx" ON "store_member"("roleId");
CREATE UNIQUE INDEX "store_member_userId_storeId_key" ON "store_member"("userId", "storeId");

-- ───────────────────────── (1) ร้านแรกจากข้อมูลเดิม ─────────────────────────

-- id คงที่เพื่อให้สคริปต์/เทสอ้างถึงได้ · ชื่อร้านเอาจาก store_settings ถ้ามี
INSERT INTO "store" ("id", "slug", "name", "updatedAt")
SELECT 'store_default', 'default', COALESCE((SELECT "storeName" FROM "store_settings" LIMIT 1), 'ร้านของฉัน'), CURRENT_TIMESTAMP;

-- ───────────────────────── (2) store_id ทุกตารางราก ─────────────────────────

ALTER TABLE "product"          ADD COLUMN "storeId" TEXT;
ALTER TABLE "stock_transaction" ADD COLUMN "storeId" TEXT;
ALTER TABLE "category"         ADD COLUMN "storeId" TEXT;
ALTER TABLE "sale"             ADD COLUMN "storeId" TEXT;
ALTER TABLE "cashier_closing"  ADD COLUMN "storeId" TEXT;
ALTER TABLE "restaurant_table" ADD COLUMN "storeId" TEXT;
ALTER TABLE "table_session"    ADD COLUMN "storeId" TEXT;
ALTER TABLE "menu_item"        ADD COLUMN "storeId" TEXT;
ALTER TABLE "modifier_group"   ADD COLUMN "storeId" TEXT;
ALTER TABLE "mobile_order"     ADD COLUMN "storeId" TEXT;
ALTER TABLE "qr_code"          ADD COLUMN "storeId" TEXT;
ALTER TABLE "notification"     ADD COLUMN "storeId" TEXT;
ALTER TABLE "member"           ADD COLUMN "storeId" TEXT;
ALTER TABLE "payment_intent"   ADD COLUMN "storeId" TEXT;
ALTER TABLE "role"             ADD COLUMN "storeId" TEXT;
ALTER TABLE "store_settings"   ADD COLUMN "storeId" TEXT;

UPDATE "product"           SET "storeId" = 'store_default';
UPDATE "stock_transaction" SET "storeId" = 'store_default';
UPDATE "category"          SET "storeId" = 'store_default';
UPDATE "sale"              SET "storeId" = 'store_default';
UPDATE "cashier_closing"   SET "storeId" = 'store_default';
UPDATE "restaurant_table"  SET "storeId" = 'store_default';
UPDATE "table_session"     SET "storeId" = 'store_default';
UPDATE "menu_item"         SET "storeId" = 'store_default';
UPDATE "modifier_group"    SET "storeId" = 'store_default';
UPDATE "mobile_order"      SET "storeId" = 'store_default';
UPDATE "qr_code"           SET "storeId" = 'store_default';
UPDATE "notification"      SET "storeId" = 'store_default';
UPDATE "member"            SET "storeId" = 'store_default';
UPDATE "payment_intent"    SET "storeId" = 'store_default';
UPDATE "role"              SET "storeId" = 'store_default';
UPDATE "store_settings"    SET "storeId" = 'store_default';

-- ร้านต้องมี settings เสมอ — ฐานที่ยังไม่เคย seed จะไม่มีแถว "default"
INSERT INTO "store_settings" ("id", "storeId", "storeName", "themeColor", "updatedAt")
SELECT 'store_default', 'store_default', 'ร้านของฉัน', '#E8571F', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "store_settings");

ALTER TABLE "product"           ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "stock_transaction" ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "category"          ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "sale"              ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "cashier_closing"   ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "restaurant_table"  ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "table_session"     ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "menu_item"         ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "modifier_group"    ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "mobile_order"      ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "qr_code"           ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "notification"      ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "member"            ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "payment_intent"    ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "role"              ALTER COLUMN "storeId" SET NOT NULL;
ALTER TABLE "store_settings"    ALTER COLUMN "storeId" SET NOT NULL;

-- store_settings เลิกเป็น singleton
ALTER TABLE "store_settings" ALTER COLUMN "id" DROP DEFAULT;

-- ───────────────────────── (3) unique เดิม → ต่อร้าน ─────────────────────────

DROP INDEX "product_sku_key";
DROP INDEX "category_name_key";
DROP INDEX "sale_saleNumber_key";
DROP INDEX "cashier_closing_cashierId_closingDate_key";
DROP INDEX "restaurant_table_code_key";
DROP INDEX "member_phone_key";
DROP INDEX "role_name_key";

CREATE UNIQUE INDEX "product_storeId_sku_key"                        ON "product"("storeId", "sku");
CREATE UNIQUE INDEX "category_storeId_name_key"                      ON "category"("storeId", "name");
CREATE UNIQUE INDEX "sale_storeId_saleNumber_key"                    ON "sale"("storeId", "saleNumber");
CREATE UNIQUE INDEX "cashier_closing_storeId_cashierId_closingDate_key" ON "cashier_closing"("storeId", "cashierId", "closingDate");
CREATE UNIQUE INDEX "restaurant_table_storeId_code_key"              ON "restaurant_table"("storeId", "code");
CREATE UNIQUE INDEX "member_storeId_phone_key"                       ON "member"("storeId", "phone");
CREATE UNIQUE INDEX "role_storeId_name_key"                          ON "role"("storeId", "name");
CREATE UNIQUE INDEX "store_settings_storeId_key"                     ON "store_settings"("storeId");

CREATE INDEX "product_storeId_idx"           ON "product"("storeId");
CREATE INDEX "stock_transaction_storeId_idx" ON "stock_transaction"("storeId");
CREATE INDEX "category_storeId_idx"          ON "category"("storeId");
CREATE INDEX "sale_storeId_idx"              ON "sale"("storeId");
CREATE INDEX "cashier_closing_storeId_idx"   ON "cashier_closing"("storeId");
CREATE INDEX "restaurant_table_storeId_idx"  ON "restaurant_table"("storeId");
CREATE INDEX "table_session_storeId_idx"     ON "table_session"("storeId");
CREATE INDEX "menu_item_storeId_idx"         ON "menu_item"("storeId");
CREATE INDEX "modifier_group_storeId_idx"    ON "modifier_group"("storeId");
CREATE INDEX "mobile_order_storeId_idx"      ON "mobile_order"("storeId");
CREATE INDEX "qr_code_storeId_idx"           ON "qr_code"("storeId");
CREATE INDEX "notification_storeId_idx"      ON "notification"("storeId");
CREATE INDEX "member_storeId_idx"            ON "member"("storeId");
CREATE INDEX "payment_intent_storeId_idx"    ON "payment_intent"("storeId");
CREATE INDEX "role_storeId_idx"              ON "role"("storeId");

-- ───────────────────────── (4) ผู้ใช้เดิม → สมาชิกร้าน default ─────────────────────────

-- ผู้ดูแลระบบ (บทบาท isSystem) → OWNER · คนอื่น → STAFF พร้อม matrix สิทธิ์เดิม
-- (ไม่ทำทุกคนเป็น OWNER ตามร่างแรกของ spec เพราะ RBAC F1–F9 ใช้งานจริงอยู่แล้ว
--  การยก แคชเชียร์ เป็น OWNER = ให้สิทธิ์เต็มโดยไม่ตั้งใจ)
INSERT INTO "store_member" ("id", "userId", "storeId", "role", "roleId", "updatedAt")
SELECT
    'sm_' || u."id",
    u."id",
    'store_default',
    CASE WHEN r."isSystem" THEN 'OWNER'::"StoreRole" ELSE 'STAFF'::"StoreRole" END,
    u."roleId",
    CURRENT_TIMESTAMP
FROM "user" u
LEFT JOIN "role" r ON r."id" = u."roleId";

ALTER TABLE "user" DROP CONSTRAINT "user_roleId_fkey";
DROP INDEX "user_roleId_idx";
ALTER TABLE "user" DROP COLUMN "roleId";
ALTER TABLE "user" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- ───────────────────────── foreign keys ─────────────────────────

ALTER TABLE "product"           ADD CONSTRAINT "product_storeId_fkey"           FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transaction" ADD CONSTRAINT "stock_transaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role"              ADD CONSTRAINT "role_storeId_fkey"              FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "category"          ADD CONSTRAINT "category_storeId_fkey"          FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale"              ADD CONSTRAINT "sale_storeId_fkey"              FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cashier_closing"   ADD CONSTRAINT "cashier_closing_storeId_fkey"   FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "restaurant_table"  ADD CONSTRAINT "restaurant_table_storeId_fkey"  FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "table_session"     ADD CONSTRAINT "table_session_storeId_fkey"     FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "menu_item"         ADD CONSTRAINT "menu_item_storeId_fkey"         FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modifier_group"    ADD CONSTRAINT "modifier_group_storeId_fkey"    FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mobile_order"      ADD CONSTRAINT "mobile_order_storeId_fkey"      FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qr_code"           ADD CONSTRAINT "qr_code_storeId_fkey"           FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification"      ADD CONSTRAINT "notification_storeId_fkey"      FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_settings"    ADD CONSTRAINT "store_settings_storeId_fkey"    FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member"            ADD CONSTRAINT "member_storeId_fkey"            FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_intent"    ADD CONSTRAINT "payment_intent_storeId_fkey"    FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_member"      ADD CONSTRAINT "store_member_userId_fkey"       FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_member"      ADD CONSTRAINT "store_member_storeId_fkey"      FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_member"      ADD CONSTRAINT "store_member_roleId_fkey"       FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
