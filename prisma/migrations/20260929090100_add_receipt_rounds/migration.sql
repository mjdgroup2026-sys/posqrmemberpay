-- Phase 21d (2/2) — ใบรับรับได้หลายรอบ: รอบรับ + ยอดรับแล้ว/ยกเลิกต่อบรรทัด + ledger ผูกรอบ
-- มี backfill: ใบรับเดิมทุกใบกลายเป็น "รอบที่ 1" ของตัวเอง (ของเข้าแล้วครั้งเดียว) · ใบเบิก/ใบปรับไม่แตะ

-- AlterTable
ALTER TABLE "stock_document_line" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "receivedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_transaction" ADD COLUMN     "receiptRoundId" TEXT;

-- CreateTable
CREATE TABLE "stock_receipt_round" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "receivedDate" DATE NOT NULL,
    "referenceNo" TEXT,
    "note" TEXT,
    "status" "StockDocStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "stock_receipt_round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_receipt_round_line" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "documentLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "stock_receipt_round_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_receipt_round_storeId_idx" ON "stock_receipt_round"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_receipt_round_documentId_roundNo_key" ON "stock_receipt_round"("documentId", "roundNo");

-- CreateIndex
CREATE INDEX "stock_receipt_round_line_roundId_idx" ON "stock_receipt_round_line"("roundId");

-- CreateIndex
CREATE INDEX "stock_receipt_round_line_documentLineId_idx" ON "stock_receipt_round_line"("documentLineId");

-- CreateIndex
CREATE INDEX "stock_transaction_receiptRoundId_idx" ON "stock_transaction"("receiptRoundId");

-- AddForeignKey
ALTER TABLE "stock_transaction" ADD CONSTRAINT "stock_transaction_receiptRoundId_fkey" FOREIGN KEY ("receiptRoundId") REFERENCES "stock_receipt_round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_round" ADD CONSTRAINT "stock_receipt_round_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_round" ADD CONSTRAINT "stock_receipt_round_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "stock_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_round" ADD CONSTRAINT "stock_receipt_round_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_round" ADD CONSTRAINT "stock_receipt_round_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_round_line" ADD CONSTRAINT "stock_receipt_round_line_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "stock_receipt_round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_round_line" ADD CONSTRAINT "stock_receipt_round_line_documentLineId_fkey" FOREIGN KEY ("documentLineId") REFERENCES "stock_document_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────── backfill ใบรับเดิม (Phase 21 ก่อน 21d = บันทึกแล้วรับครบทันที) ─────────

-- รอบที่ 1 ของทุกใบรับ · ใบที่ยกเลิกไปแล้ว = รอบที่ยกเลิก (ข้อมูลผู้ยกเลิกคัดลอกจากหัวใบ)
INSERT INTO "stock_receipt_round"
  ("id", "storeId", "documentId", "roundNo", "receivedDate", "referenceNo", "note", "status",
   "createdById", "createdAt", "voidedAt", "voidedById", "voidReason")
SELECT 'rr_' || d."id", d."storeId", d."id", 1, d."docDate", d."referenceNo", NULL,
       CASE WHEN d."status" = 'VOIDED' THEN 'VOIDED'::"StockDocStatus" ELSE 'POSTED'::"StockDocStatus" END,
       d."createdById", d."createdAt", d."voidedAt", d."voidedById", d."voidReason"
FROM "stock_document" d
WHERE d."type" = 'RECEIPT';

INSERT INTO "stock_receipt_round_line" ("id", "roundId", "documentLineId", "productId", "quantity")
SELECT 'rrl_' || l."id", 'rr_' || l."documentId", l."id", l."productId", l."quantity"
FROM "stock_document_line" l
JOIN "stock_document" d ON d."id" = l."documentId"
WHERE d."type" = 'RECEIPT';

-- ยอดรับแล้วนับเฉพาะรอบที่ยังไม่ยกเลิก
UPDATE "stock_document_line" l
SET "receivedQty" = l."quantity"
FROM "stock_document" d
WHERE d."id" = l."documentId" AND d."type" = 'RECEIPT' AND d."status" = 'POSTED';

-- ledger เดิมของใบรับ (รวมรายการชดเชยตอนยกเลิก) ผูกรอบที่ 1
UPDATE "stock_transaction" t
SET "receiptRoundId" = 'rr_' || t."documentId"
FROM "stock_document" d
WHERE d."id" = t."documentId" AND d."type" = 'RECEIPT';

UPDATE "stock_document" SET "status" = 'RECEIVED' WHERE "type" = 'RECEIPT' AND "status" = 'POSTED';

-- รับแล้ว + ยกเลิก ห้ามเกินจำนวนสั่ง (ด่านสุดท้ายในฐาน — ตรรกะจริงอยู่ที่ lib/stock-docs.ts ใต้ล็อกหัวใบ)
-- ใบปรับเก็บส่วนต่างติดลบใน quantity ได้ จึงเทียบกับ GREATEST(quantity, 0) · บรรทัดใบเบิก/ใบปรับเป็น 0 เสมอ
ALTER TABLE "stock_document_line" ADD CONSTRAINT "stock_document_line_received_check"
  CHECK ("receivedQty" >= 0 AND "cancelledQty" >= 0 AND "receivedQty" + "cancelledQty" <= GREATEST("quantity", 0));
