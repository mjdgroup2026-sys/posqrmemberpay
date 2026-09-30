-- เปิดรอบปิดยอดที่ปิดแล้วใหม่ (2026-09-30)
--
-- เปิดใหม่ = ถอดบิลของรอบนั้นกลับเป็น "ยังไม่ปิดรอบ" (sale.closingId = NULL) แล้วให้แคชเชียร์ปิดเป็นรอบถัดไป
-- แถวรอบเดิมไม่ลบ — เก็บคนเปิด/เวลา/เหตุผลไว้เป็นประวัติ · additive ล้วน ไม่แตะข้อมูลเดิม

-- AlterTable
ALTER TABLE "cashier_closing" ADD COLUMN     "reopenReason" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "reopenedById" TEXT;

-- เปิดใหม่ต้องมีเหตุผลเสมอ (ด่านสุดท้ายในฐาน — action ตรวจความยาวก่อนแล้ว)
ALTER TABLE "cashier_closing" ADD CONSTRAINT "cashier_closing_reopen_reason_check"
  CHECK (("reopenedAt" IS NULL) = ("reopenReason" IS NULL));

-- AddForeignKey
ALTER TABLE "cashier_closing" ADD CONSTRAINT "cashier_closing_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
