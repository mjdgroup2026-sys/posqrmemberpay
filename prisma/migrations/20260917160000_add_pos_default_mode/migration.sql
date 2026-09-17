-- โหมดเริ่มต้นของจอขายอาหาร (2026-09-17) — additive ล้วน ทุกร้านเดิมได้ TABLE (พฤติกรรมเดิม)

-- CreateEnum
CREATE TYPE "PosDefaultMode" AS ENUM ('TABLE', 'TAKEAWAY');

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "posDefaultMode" "PosDefaultMode" NOT NULL DEFAULT 'TABLE';
