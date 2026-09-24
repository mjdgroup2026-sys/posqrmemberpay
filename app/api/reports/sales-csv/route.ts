import { NextResponse, type NextRequest } from "next/server"
import { requireStoreAccess } from "@/lib/permissions"
import { storeErrorMessage } from "@/lib/store-errors"
import { listSalesForExport, type SaleKind } from "@/lib/queries"
import { resolveDayRange } from "@/lib/day"
import { buildSalesCsv } from "@/lib/sales-csv"

/// ดาวน์โหลดรายการขายเป็น CSV (20e ข้อ 8) — `?from=&to=&kind=FOOD|SERVICE|PRODUCT` (ไม่ส่ง kind = ทุกประเภท)
/// · `&therapist=&type=` (20f) กรองพนักงานนวด/ประเภทบริการ ตามแถบตัวกรองของ /spa/reports
///
/// ด่านเดียวกับหน้ารายงาน: ร้านที่ทำงานอยู่ + สิทธิ์ REPORTS:VIEW · ไฟล์เฉพาะนวดเปิดให้คนที่ดูรายงานสปาได้ด้วย
/// (SPA_THERAPISTS:VIEW — ตรงกับด่านของหน้า /spa/reports) · ช่วงวันผ่าน resolveDayRange (ห้ามอนาคต · เพดาน 366 วัน)
export const dynamic = "force-dynamic"

const KINDS: SaleKind[] = ["FOOD", "SERVICE", "PRODUCT"]

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const rawKind = params.get("kind")
  const kind = rawKind && (KINDS as string[]).includes(rawKind) ? (rawKind as SaleKind) : null

  let storeId: string
  try {
    const ctx =
      kind === "SERVICE"
        ? await requireStoreAccess(["REPORTS", "VIEW"], ["SPA_THERAPISTS", "VIEW"])
        : await requireStoreAccess(["REPORTS", "VIEW"])
    storeId = ctx.storeId
  } catch (error) {
    const message = storeErrorMessage(error)
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 403
    return NextResponse.json({ ok: false, error: message }, { status })
  }

  const range = resolveDayRange(params.get("from"), params.get("to"))
  // ตัวกรองรายงานสปา (20f) — id ร้านอื่นได้ไฟล์ว่าง เพราะ query กรอง storeId อยู่แล้ว
  const rows = await listSalesForExport(storeId, range, kind, {
    therapistId: params.get("therapist") || null,
    stationId: params.get("type") || null,
  })
  const suffix = kind ? `-${kind.toLowerCase()}` : ""
  const filename = `sales${suffix}-${range.from}-to-${range.to}.csv`

  return new NextResponse(buildSalesCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // รายงานเงินของร้าน — ห้ามให้ cache ใดเก็บไว้
      "Cache-Control": "no-store",
    },
  })
}
