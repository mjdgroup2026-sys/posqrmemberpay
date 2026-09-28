import Link from "next/link"
import { getReorderReport, getStoreSettings } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { REORDER_COVER_DAYS } from "@/lib/reorder"
import { formatBaht, formatBusinessDate, formatNumber } from "@/lib/format"
import { PrintButton } from "@/components/print-button"
import { IconBack, IconPlus } from "@/components/icons"

export const metadata = { title: "สินค้าต้องสั่งซื้อ" }

const head = { padding: "8px 12px", fontWeight: 500 } as const
const numHead = { ...head, textAlign: "right" } as const
const cell = { padding: "8px 12px" } as const
const numCell = { padding: "8px 12px", textAlign: "right" } as const

/// รายงานสินค้าใกล้หมดและต้องสั่งซื้อ (Phase 21c · F33) — คงเหลือ ≤ จุดสั่งซื้อ พร้อมจำนวนแนะนำ (สูตรใน lib/reorder.ts)
/// พิมพ์เป็นใบสั่งซื้อร่างได้ · ปุ่มสร้างใบรับสินค้าเติมบรรทัดตามจำนวนแนะนำให้ (แก้ได้ก่อนบันทึก)
export default async function ReorderReportPage() {
  const { storeId, granted } = await requirePageAccess("REPORTS")
  const canReceive = granted.STOCK_IN?.includes("ADD") ?? false
  const [report, settings] = await Promise.all([getReorderReport(storeId), getStoreSettings(storeId)])
  const estimatedTotal = report.rows.reduce((sum, row) => sum + (row.estimatedCost ?? 0), 0)
  const missingCost = report.rows.filter((row) => row.estimatedCost === null).length

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="t-eyebrow">
            <Link href="/reports" className="row" style={{ gap: 6, display: "inline-flex" }}>
              <IconBack size={14} aria-hidden />
              รายงาน
            </Link>
          </p>
          <h1 className="t-h1">สินค้าใกล้หมด / ต้องสั่งซื้อ</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            สินค้าที่คงเหลือถึงจุดสั่งซื้อแล้ว · จำนวนแนะนำคิดจากยอดขายเฉลี่ย {report.lookbackDays} วันล่าสุด ให้พอขายอีก {REORDER_COVER_DAYS} วัน
            (ยังไม่มียอดขาย = เติมให้ถึง 2 เท่าของจุดสั่งซื้อ)
          </p>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <PrintButton label="พิมพ์ใบสั่งซื้อ" />
          {canReceive && report.rows.length > 0 ? (
            <Link href="/stock/receipts/new?from=reorder" className="btn btn-primary">
              <IconPlus size={17} aria-hidden />
              สร้างใบรับสินค้าจากรายการนี้
            </Link>
          ) : null}
        </div>
      </div>

      <article className="card-ui doc-print">
        <div className="panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
          <div>
            <p className="t-caption">{settings?.storeName ?? ""}</p>
            <h2 className="t-h2">รายการสินค้าที่ต้องสั่งซื้อ</h2>
          </div>
          <span className="t-small num">
            ณ {formatBusinessDate(new Date())} · {formatNumber(report.rows.length)} รายการ
          </span>
        </div>

        {report.rows.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ยังไม่มีสินค้าที่ถึงจุดสั่งซื้อ
          </p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={head}>สินค้า</th>
                  <th style={numHead}>คงเหลือ</th>
                  <th style={numHead}>จุดสั่งซื้อ</th>
                  <th style={numHead}>ขายเฉลี่ย/วัน</th>
                  <th style={numHead}>อยู่ได้อีก</th>
                  <th style={numHead}>แนะนำให้สั่ง</th>
                  <th style={head}>ผู้ขายล่าสุด</th>
                  <th style={numHead}>ทุน/หน่วยล่าสุด</th>
                  <th style={numHead}>ประมาณการ</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.productId} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={cell}>
                      <div style={{ fontWeight: 500 }}>{row.name}</div>
                      <div className="t-caption num">
                        {row.sku} · {row.categoryName}
                      </div>
                    </td>
                    <td className="num" style={{ ...numCell, color: row.quantity <= 0 ? "var(--danger)" : undefined, fontWeight: 600 }}>
                      {row.quantity <= 0 ? "หมด" : `${formatNumber(row.quantity)} ${row.unit}`}
                    </td>
                    <td className="num" style={numCell}>
                      {formatNumber(row.reorderPoint)}
                    </td>
                    <td className="num" style={numCell}>
                      {row.avgDailySold === 0 ? "—" : row.avgDailySold.toFixed(2)}
                    </td>
                    <td className="num" style={numCell}>
                      {row.daysLeft === null ? "—" : `${formatNumber(row.daysLeft)} วัน`}
                    </td>
                    <td className="num" style={{ ...numCell, fontWeight: 700, color: "var(--brand)" }}>
                      {formatNumber(row.suggestedQty)} {row.unit}
                    </td>
                    <td style={cell}>{row.lastSupplier ?? "—"}</td>
                    <td className="num" style={numCell}>
                      {row.lastUnitCost === null ? "—" : formatBaht(row.lastUnitCost)}
                    </td>
                    <td className="num" style={numCell}>
                      {row.estimatedCost === null ? "—" : formatBaht(row.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--line)" }}>
                  <td colSpan={8} style={{ ...numCell, fontWeight: 600 }}>
                    ประมาณการรวม{missingCost > 0 ? ` (ไม่รวม ${formatNumber(missingCost)} รายการที่ยังไม่เคยกรอกราคาทุน)` : ""}
                  </td>
                  <td className="num" style={{ ...numCell, fontWeight: 700 }}>
                    ฿{formatBaht(estimatedTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </article>
    </>
  )
}
