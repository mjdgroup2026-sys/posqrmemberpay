import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { listProductOptions, getReorderReport } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { stockDocKind } from "@/lib/stock-doc-kinds"
import { businessDayKey } from "@/lib/day"
import { StockDocForm, type StockDocPrefill } from "@/components/stock-doc-form"
import { ReceiptForm } from "@/components/receipt-form"
import { IconBack } from "@/components/icons"

export async function generateMetadata({ params }: PageProps<"/stock/[kind]/new">) {
  const kind = stockDocKind((await params).kind)
  return { title: kind?.newTitle ?? "สร้างเอกสารคลัง" }
}

/// ฟอร์มสร้างเอกสารคลัง (Phase 21 · F30) · `?from=reorder` = เติมบรรทัดจากรายงานสินค้าต้องสั่งซื้อ (F33) ให้ในใบรับ
export default async function NewStockDocPage({ params, searchParams }: PageProps<"/stock/[kind]/new">) {
  const kind = stockDocKind((await params).kind)
  if (!kind) notFound()
  const { storeId, granted } = await requirePageAccess(kind.resource)
  // ไม่มีสิทธิ์บันทึก = กลับไปหน้ารายการ (ด่านจริงอยู่ที่ action อีกชั้น)
  if (!granted[kind.resource]?.includes("ADD")) redirect(`/stock/${kind.slug}`)

  const query = await searchParams
  const [products, reorder] = await Promise.all([
    listProductOptions(storeId),
    kind.type === "RECEIPT" && query.from === "reorder" ? getReorderReport(storeId) : Promise.resolve(null),
  ])
  // จำนวนแนะนำชุดเดียวกับรายงานสินค้าต้องสั่งซื้อ (lib/reorder.ts) — ผู้ใช้แก้ในฟอร์มได้ก่อนบันทึก
  const prefill: StockDocPrefill[] = (reorder?.rows ?? []).map((row) => ({ productId: row.productId, quantity: row.suggestedQty }))

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href={`/stock/${kind.slug}`} className="row" style={{ gap: 6, display: "inline-flex" }}>
              <IconBack size={14} aria-hidden />
              {kind.title}
            </Link>
          </p>
          <h1 className="t-h1">{kind.newTitle}</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            {kind.description}
          </p>
        </div>
      </div>

      {kind.slug === "receipts" ? (
        <ReceiptForm products={products} today={businessDayKey()} prefill={prefill} />
      ) : (
        <StockDocForm kind={kind.slug} products={products} today={businessDayKey()} />
      )}
    </>
  )
}
