-- Phase 15c — SCB Open API ต่อร้าน (StorePaymentConfig.scb*) · additive ล้วน ไม่มี backfill
-- ร้าน default ยังใช้ env SCB_* ของแพลตฟอร์มเป็น fallback จนกว่าจะย้าย credential เข้าฐานผ่านหน้าตั้งค่าร้านแล้วผ่านการทดสอบ
-- ปิดท้ายต้องได้ prisma migrate diff --exit-code = No difference detected.

-- AlterTable
ALTER TABLE "store_payment_config" ADD COLUMN     "scbApiBase" TEXT,
ADD COLUMN     "scbApiKeyEnc" TEXT,
ADD COLUMN     "scbApiSecretEnc" TEXT,
ADD COLUMN     "scbBillerId" TEXT,
ADD COLUMN     "scbRef3Prefix" TEXT,
ADD COLUMN     "scbTestRef1" TEXT,
ADD COLUMN     "scbTestStartedAt" TIMESTAMP(3),
ADD COLUMN     "scbVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "scbWebhookToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "store_payment_config_scbWebhookToken_key" ON "store_payment_config"("scbWebhookToken");

-- CreateIndex
CREATE UNIQUE INDEX "store_payment_config_scbTestRef1_key" ON "store_payment_config"("scbTestRef1");

