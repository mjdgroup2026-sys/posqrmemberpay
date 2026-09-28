-- Phase 21 (2/2) — เอกสารคลัง Header/Detail + ขายสินค้าในสต็อกจากจอขายอาหาร · additive ล้วน ไม่มี backfill
-- CreateEnum
CREATE TYPE "StockDocType" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUST');

-- CreateEnum
CREATE TYPE "StockDocStatus" AS ENUM ('POSTED', 'VOIDED');


-- AlterTable
ALTER TABLE "category" ADD COLUMN     "sellableAtPos" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "mobile_order_item" ADD COLUMN     "productId" TEXT,
ALTER COLUMN "menuItemId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stock_transaction" ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "orderItemId" TEXT;

-- CreateTable
CREATE TABLE "stock_document" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "StockDocType" NOT NULL,
    "docNumber" TEXT NOT NULL,
    "docDate" DATE NOT NULL,
    "status" "StockDocStatus" NOT NULL DEFAULT 'POSTED',
    "supplierName" TEXT,
    "referenceNo" TEXT,
    "requesterName" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "totalCost" DECIMAL(12,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "stock_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_document_line" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2),
    "lineTotal" DECIMAL(12,2),
    "systemQty" INTEGER,
    "countedQty" INTEGER,
    "note" TEXT,

    CONSTRAINT "stock_document_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_document_storeId_type_docDate_idx" ON "stock_document"("storeId", "type", "docDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_document_storeId_docNumber_key" ON "stock_document"("storeId", "docNumber");

-- CreateIndex
CREATE INDEX "stock_document_line_documentId_idx" ON "stock_document_line"("documentId");

-- CreateIndex
CREATE INDEX "stock_document_line_productId_idx" ON "stock_document_line"("productId");

-- CreateIndex
CREATE INDEX "stock_transaction_documentId_idx" ON "stock_transaction"("documentId");

-- CreateIndex
CREATE INDEX "stock_transaction_orderItemId_idx" ON "stock_transaction"("orderItemId");

-- AddForeignKey
ALTER TABLE "stock_transaction" ADD CONSTRAINT "stock_transaction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "stock_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transaction" ADD CONSTRAINT "stock_transaction_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "mobile_order_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document" ADD CONSTRAINT "stock_document_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document" ADD CONSTRAINT "stock_document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document" ADD CONSTRAINT "stock_document_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_line" ADD CONSTRAINT "stock_document_line_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "stock_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_line" ADD CONSTRAINT "stock_document_line_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_order_item" ADD CONSTRAINT "mobile_order_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- บรรทัดออร์เดอร์ต้องเป็นเมนูหรือสินค้าอย่างใดอย่างหนึ่งเสมอ (แถวเดิมทุกแถวมี menuItemId จึงผ่าน)
ALTER TABLE "mobile_order_item" ADD CONSTRAINT "mobile_order_item_menu_or_product_check"
  CHECK (("menuItemId" IS NOT NULL) <> ("productId" IS NOT NULL));
