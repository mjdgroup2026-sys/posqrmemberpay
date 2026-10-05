-- ค่าตั้งของแพลตฟอร์ม (2026-10-05) — additive ล้วน ไม่มี backfill (ว่าง = ใช้ env PLATFORM_PROMPTPAY_ID เดิม)

-- CreateTable
CREATE TABLE "platform_setting" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "promptPayId" TEXT,
    "promptPayName" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_setting_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "platform_setting" ADD CONSTRAINT "platform_setting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- แถวเดียวทั้งระบบ
ALTER TABLE "platform_setting" ADD CONSTRAINT "platform_setting_singleton_check" CHECK ("id" = 'platform');
