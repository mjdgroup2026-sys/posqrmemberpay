import Link from "next/link"
import { getStockSalesReport, type StockSalesRow } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { businessDayKey, resolveDayRange } from "@/lib/day"
import { formatBaht, formatBusinessDate, formatNumber } from "@/lib/format"
import { DayRangePicker } from "@/components/day-range-picker"
import { IconBack, IconDownload } from "@/components/icons"

export const metadata = { title: "รายงานขายตัดสต็อก" }

const head = { padding: "8px 12px", fontWeight: 500, textAlign: "right" } as const
const cell = { padding: "8px 12px", textAlign: "right" } as const

/// ตัวเลขมีเครื่องหมาย — 0 แสดงเป็นขีด ให้ตารางอ่านง่ายว่าวันนั้นไม่มีความเคลื่อนไหว
function signed(value: number): string {
  if (value === 0) return "—"
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`
}
function plain(value: number): string {
  return value === 0 ? "—" : formatNumber(value)
}

function StockTable({ rows, showOnHand }: { rows: StockSalesRow[]; showOnHand: boolean }) {
  return (
    <div className="datatable-wrap">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
        <thead>
          <tr style={{ color: "var(--ink-3)", background: "var(--surface-2)" }}>
            <th style={{ ...head, textAlign: "left" }}>สินค้า</th>
            <th style={head}>ขาย (ตัดสต็อก)</th>
            <th style={head}>ยอดขาย (บาท)</th>
            <th style={head}>รับเข้า</th>
            <th style={head}>เบิกออก</th>
            <th style={head}>ปรับยอด</th>
            <th style={head} title="รายการก่อนมีเอกสาร (รับเข้า/เบิกทีละรายการแบบเดิม)">
              อื่น ๆ
            </th>
            {showOnHand ? <th style={head}>คงเหลือตอนนี้</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.productId} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: "8px 12px" }}>
                <span style={{ fontWeight: 500 }}>{row.name}</span> <span className="t-caption num">({row.sku})</span>
              </td>
              <td className="num" style={{ ...cell, fontWeight: 600 }}>
                {row.soldQty === 0 ? "—" : `${formatNumber(row.soldQty)} ${row.unit}`}
              </td>
              <td className="num" style={cell}>
                {row.soldAmount === 0 ? "—" : formatBaht(row.soldAmount)}
              </td>
              <td className="num" style={cell}>
                {plain(row.receivedQty)}
              </td>
              <td className="num" style={cell}>
                {plain(row.issuedQty)}
              </td>
              <td className="num" style={cell}>
                {signed(row.adjustedQty)}
              </td>
              <td className="num" style={cell}>
                {signed(row.otherQty)}
              </td>
              {showOnHand ? (
                <td className="num" style={cell}>
                  {formatNumber(row.onHand)} {row.unit}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/// รายงานการขายสินค้าที่ตัดสต็อกรายวัน (Phase 21c · F32)
///
/// จำนวนขายนับจาก ledger ตามวันที่ตัดสต็อกจริง (หักคืนจาก void/ยกเลิกแล้ว) · ยอดเงินนับจากบิลที่ปิดแล้วตามวันออกบิล —
/// สินค้าบนโต๊ะตัดสต็อกตอนส่งแต่ออกบิลตอนปิดโต๊ะ สองตัวเลขจึงอาจตกคนละวันได้ถ้าโต๊ะข้ามเที่ยงคืน
export default async function StockSalesReportPage({ searchParams }: PageProps<"/reports/stock-sales">) {
  const { storeId } = await requirePageAccess("REPORTS")
  const query = await searchParams
  const range = resolveDayRange(query.from, query.to)
  const report = await getStockSalesReport(storeId, range)
  const csvHref = `/api/reports/stock-sales-csv?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href="/reports" className="row" style={{ gap: 6, display: "inline-flex" }}>
              <IconBack size={14} aria-hidden />
              รายงาน
            </Link>
          </p>
          <h1 className="t-h1">รายงานขายตัดสต็อกรายวัน</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            <span className="num">{range.from}</span> ถึง <span className="num">{range.to}</span> · จำนวนขายสุทธิหักคืนจากการยกเลิกแล้ว
          </p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <DayRangePicker basePath="/reports/stock-sales" from={range.from} to={range.to} today={businessDayKey()} />
          <a href={csvHref} className="btn btn-subtle" download>
            <IconDownload size={17} aria-hidden />
            ดาวน์โหลด CSV
          </a>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <article className="stat-tile">
          <span className="t-caption">จำนวนที่ขาย (ชิ้น)</span>
          <strong className="t-h1 num">{formatNumber(report.soldQty)}</strong>
        </article>
        <article className="stat-tile">
          <span className="t-caption">ยอดขายสินค้า</span>
          <strong className="t-h1 num">฿{formatBaht(report.soldAmount)}</strong>
        </article>
        <article className="stat-tile">
          <span className="t-caption">สินค้าที่มีความเคลื่อนไหว</span>
          <strong className="t-h1 num">{formatNumber(report.totals.length)}</strong>
          <span className="t-caption">รายการ</span>
        </article>
      </section>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">สรุปทั้งช่วง</h2>
        </div>
        {report.totals.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ไม่มีการตัดสต็อกในช่วงวันที่เลือก
          </p>
        ) : (
          <StockTable rows={report.totals} showOnHand />
        )}
      </section>

      {report.days.map((day) => (
        <section key={day.day} className="card-ui">
          <details open={report.days.length <= 3}>
            <summary className="panel-head" style={{ cursor: "pointer" }}>
              <h2 className="t-h3 num">{formatBusinessDate(day.day)}</h2>
              <span className="t-small num">
                ขาย {formatNumber(day.soldQty)} ชิ้น · ฿{formatBaht(day.soldAmount)}
              </span>
            </summary>
            <StockTable rows={day.rows} showOnHand={false} />
          </details>
        </section>
      ))}
    </>
  )
}
