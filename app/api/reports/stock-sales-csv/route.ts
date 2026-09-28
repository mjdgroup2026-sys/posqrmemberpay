import { NextResponse, type NextRequest } from "next/server"
import { requireStoreAccess } from "@/lib/permissions"
import { storeErrorMessage } from "@/lib/store-errors"
import { getStockSalesReport } from "@/lib/queries"
import { resolveDayRange } from "@/lib/day"
import { buildStockSalesCsv } from "@/lib/sales-csv"

/// ดาวน์โหลดรายงานขายตัดสต็อกรายวันเป็น CSV (Phase 21c · F32) — `?from=&to=` · ด่านเดียวกับหน้า /reports/stock-sales
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  let storeId: string
  try {
    storeId = (await requireStoreAccess(["REPORTS", "VIEW"])).storeId
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 403
    return NextResponse.json({ ok: false, error: storeErrorMessage(error) }, { status })
  }

  const params = request.nextUrl.searchParams
  const range = resolveDayRange(params.get("from"), params.get("to"))
  const report = await getStockSalesReport(storeId, range)

  return new NextResponse(buildStockSalesCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock-sales-${range.from}-to-${range.to}.csv"`,
      // รายงานของร้าน — ห้ามให้ cache ใดเก็บไว้
      "Cache-Control": "no-store",
    },
  })
}
