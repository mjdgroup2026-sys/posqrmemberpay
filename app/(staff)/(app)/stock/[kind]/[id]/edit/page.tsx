import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getStockDocument, listProductOptions } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { isOpenReceipt, stockDocKind } from "@/lib/stock-doc-kinds"
import { businessDayKey } from "@/lib/day"
import { ReceiptForm } from "@/components/receipt-form"
import { IconBack } from "@/components/icons"

export const metadata = { title: "รับสินค้า / แก้ไขใบรับ" }

/// รับสินค้าเพิ่ม / แก้ใบรับที่ยังค้างรับ (Phase 21d · ฟอร์มตารางเดียว) — ใบเบิก/ใบปรับแก้ไม่ได้ · ใบที่รับครบ/ปิด/ยกเลิกแล้ว = กลับไปหน้าดูเอกสาร
/// ด่านจริง (ล็อกหัวใบ + บรรทัดที่รับแล้ว) อยู่ที่ `updateReceipt()` ใน lib/stock-docs.ts
export default async function EditStockDocPage({ params }: PageProps<"/stock/[kind]/[id]/edit">) {
  const { kind: slug, id } = await params
  const kind = stockDocKind(slug)
  if (!kind || kind.type !== "RECEIPT") notFound()
  const { storeId, granted } = await requirePageAccess(kind.resource)

  const detailHref = `/stock/${kind.slug}/${id}`
  if (!granted[kind.resource]?.includes("ADD")) redirect(detailHref)

  const [doc, products] = await Promise.all([getStockDocument(storeId, id), listProductOptions(storeId)])
  if (!doc || doc.type !== "RECEIPT") notFound()
  if (!isOpenReceipt(doc.status)) redirect(detailHref)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href={detailHref} className="row" style={{ gap: 6, display: "inline-flex" }}>
              <IconBack size={14} aria-hidden />
              {doc.docNumber}
            </Link>
          </p>
          <h1 className="t-h1">รับสินค้า / แก้ไขใบรับ {doc.docNumber}</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            กรอกช่อง &quot;รับครั้งนี้&quot; ตามของที่ได้จริง แล้วกด &quot;บันทึก + รับสินค้า&quot; — ยังค้างรับก็กลับมารับเพิ่มที่หน้านี้ได้ ·
            รายการที่รับไปแล้วลบไม่ได้ และจำนวนสั่งต้องไม่น้อยกว่าที่รับ/ยกเลิกไปแล้ว
          </p>
        </div>
      </div>

      <ReceiptForm
        products={products}
        today={businessDayKey()}
        initial={{
          id: doc.id,
          docNumber: doc.docNumber,
          docDate: doc.docDate,
          supplierName: doc.supplierName,
          referenceNo: doc.referenceNo,
          note: doc.note,
          lines: doc.lines.map((line) => ({
            lineId: line.id,
            productId: line.productId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            receivedQty: line.receivedQty,
            cancelledQty: line.cancelledQty,
            hasRounds: line.hasRounds,
          })),
        }}
      />
    </>
  )
}
