-- เจ้าของปิดร้าน / เปิดร้านอีกครั้ง (2026-09-30) — additive ล้วน ร้านเดิมทุกร้านเป็น ACTIVE/SUSPENDED และ closedAt = NULL

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT;

-- ปิดร้านต้องมีเวลาปิดเสมอ และเปิดกลับแล้วต้องล้างเวลาปิด (ด่านสุดท้ายในฐาน — lib/store-lifecycle.ts ตั้งคู่กันอยู่แล้ว)
ALTER TABLE "store" ADD CONSTRAINT "store_closed_at_check"
  CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));

-- AddForeignKey
ALTER TABLE "store" ADD CONSTRAINT "store_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
