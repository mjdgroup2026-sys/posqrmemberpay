-- Phase 20a (2/3) — ตัวเลือกร้านนวด: พนักงานนวด · เมนูมีชนิด FOOD/SERVICE + ระยะเวลา · โต๊ะมีชนิด TABLE/ROOM + ประเภทห้อง
-- additive ล้วน ไม่มี backfill ข้อมูล: ร้านเดิม spaEnabled=false · เมนูเดิม FOOD · โต๊ะเดิม TABLE → พฤติกรรมเดิมทุกอย่าง

-- CreateEnum
CREATE TYPE "TableKind" AS ENUM ('TABLE', 'ROOM');

-- CreateEnum
CREATE TYPE "MenuItemType" AS ENUM ('FOOD', 'SERVICE');

-- AlterTable
ALTER TABLE "menu_item" ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "itemType" "MenuItemType" NOT NULL DEFAULT 'FOOD';

-- AlterTable
ALTER TABLE "mobile_order_item" ADD COLUMN     "therapistId" TEXT;

-- AlterTable
ALTER TABLE "restaurant_table" ADD COLUMN     "kind" "TableKind" NOT NULL DEFAULT 'TABLE',
ADD COLUMN     "stationId" TEXT;

-- AlterTable
ALTER TABLE "sale_item" ADD COLUMN     "therapistId" TEXT;

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "spaEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "therapist" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "phone" TEXT,
    "gender" TEXT,
    "startedAt" DATE,
    "note" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "therapist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TherapistSkills" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TherapistSkills_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "therapist_storeId_idx" ON "therapist"("storeId");

-- CreateIndex
CREATE INDEX "therapist_isActive_idx" ON "therapist"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "therapist_storeId_code_key" ON "therapist"("storeId", "code");

-- CreateIndex
CREATE INDEX "_TherapistSkills_B_index" ON "_TherapistSkills"("B");

-- CreateIndex
CREATE INDEX "restaurant_table_stationId_idx" ON "restaurant_table"("stationId");

-- AddForeignKey
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_table" ADD CONSTRAINT "restaurant_table_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "kitchen_station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist" ADD CONSTRAINT "therapist_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_order_item" ADD CONSTRAINT "mobile_order_item_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TherapistSkills" ADD CONSTRAINT "_TherapistSkills_A_fkey" FOREIGN KEY ("A") REFERENCES "kitchen_station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TherapistSkills" ADD CONSTRAINT "_TherapistSkills_B_fkey" FOREIGN KEY ("B") REFERENCES "therapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
