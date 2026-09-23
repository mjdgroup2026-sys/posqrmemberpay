-- Phase 20b — กะพนักงานนวด + การจองล่วงหน้า
-- additive ล้วน: สร้าง enum ใหม่ 1 ตัว ตาราง 2 ตาราง และคอลัมน์ตั้งค่า 1 คอลัมน์ (มี DEFAULT) — ไม่มี backfill ไม่แตะข้อมูลเดิม
-- (สร้าง TYPE ใหม่ทำในทรานแซคชันเดียวกับที่ใช้ค่าได้ — ข้อห้ามของ PostgreSQL มีเฉพาะ ALTER TYPE ... ADD VALUE)

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'IN_SERVICE', 'DONE', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN "bookingBufferMinutes" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "therapist_shift" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "isOff" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "therapist_shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "menuItemId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "therapistId" TEXT NOT NULL,
    "tableId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "note" TEXT,
    "createdById" TEXT,
    "tableSessionId" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "therapist_shift_storeId_workDate_idx" ON "therapist_shift"("storeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "therapist_shift_therapistId_workDate_key" ON "therapist_shift"("therapistId", "workDate");

-- CreateIndex
CREATE INDEX "booking_storeId_startAt_idx" ON "booking"("storeId", "startAt");

-- CreateIndex
CREATE INDEX "booking_therapistId_startAt_idx" ON "booking"("therapistId", "startAt");

-- CreateIndex
CREATE INDEX "booking_tableId_startAt_idx" ON "booking"("tableId", "startAt");

-- CreateIndex
CREATE INDEX "booking_status_idx" ON "booking"("status");

-- AddForeignKey
ALTER TABLE "therapist_shift" ADD CONSTRAINT "therapist_shift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_shift" ADD CONSTRAINT "therapist_shift_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "table_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
