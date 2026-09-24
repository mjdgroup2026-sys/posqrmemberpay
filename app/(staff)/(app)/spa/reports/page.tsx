import Link from "next/link"
import { getStoreSettings, getTherapistSalesReport } from "@/lib/queries"
import { businessDayKey, resolveDayRange } from "@/lib/day"
import { formatBaht, formatNumber } from "@/lib/format"
import { requirePageAccess } from "@/lib/permissions"
import { DayRangePicker } from "@/components/day-range-picker"
import { IconReports } from "@/components/icons"

export const metadata = { title: "รายงานพนักงานนวด" }

/// นาทีรวม → "12 ชม. 30 น." — ตัวเลขนาทีดิบอ่านยากเมื่อเกินหลักร้อย
function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${formatNumber(minutes)} นาที`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${formatNumber(hours)} ชม.` : `${formatNumber(hours)} ชม. ${rest} น.`
}

/// รายงานต่อพนักงานนวด (Phase 20c) — ยอด/จำนวนครั้ง/นาทีรวม ต่อคน ในช่วงวันที่เลือก
///
/// อ่านจาก `SaleItem.therapistId` ที่ snapshot ตอนปิดบิล จึงตรงกับเงินที่เก็บได้จริง
/// และบิลที่ถูก void หายจากรายงานเองโดยไม่ต้องมีตรรกะพิเศษ
export default async function SpaReportsPage({ searchParams }: PageProps<"/spa/reports">) {
  // เข้าได้ทั้งคนที่ดูแลพนักงานนวดและคนที่ดูรายงาน (ตัดสินใจ 2026-09-23)
  const { storeId } = await requirePageAccess("SPA_THERAPISTS", "REPORTS")

  const query = await searchParams
  const range = resolveDayRange(query.from, query.to)
  const [settings, rows] = await Promise.all([getStoreSettings(storeId), getTherapistSalesReport(storeId, range)])

  if (!settings?.spaEnabled) {
    return (
      <section className="card-ui card-pad" style={{ maxWidth: 620 }}>
        <span className="chip chip-warning">
          <span className="dot" />
          ยังไม่ได้เปิดตัวเลือกร้านนวด
        </span>
        <h1 className="t-h1" style={{ marginTop: 12 }}>
          รายงานพนักงานนวด
        </h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          เปิด “ตัวเลือกร้านนวด” ในตั้งค่าร้านก่อน จึงจะมีข้อมูลการให้บริการให้สรุป
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18 }}>
          <Link href="/mobile-order/settings" className="btn btn-primary">
            ไปตั้งค่าร้าน
          </Link>
        </div>
      </section>
    )
  }

  const worked = rows.filter((row) => row.services > 0)
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const totalServices = rows.reduce((sum, row) => sum + row.services, 0)
  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ร้านนวด</p>
          <h1 className="t-h1">
            <span className="row" style={{ gap: 10 }}>
              <IconReports size={22} aria-hidden />
              รายงานพนักงานนวด
            </span>
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            นับจากบรรทัดโปรแกรมนวดในบิลที่ปิดแล้ว (บิลที่ยกเลิกไม่ถูกนับ) — ยอดนี้เป็นค่าบริการของรายการนวดเท่านั้น
            ไม่รวมอาหาร/เครื่องดื่มในบิลเดียวกันและไม่รวมค่าบริการท้ายบิล
          </p>
        </div>
        <DayRangePicker basePath="/spa/reports" from={range.from} to={range.to} today={businessDayKey()} />
      </div>

      <div className="field-grid" style={{ marginBottom: 18 }}>
        <div className="stat-tile">
          <span className="t-caption">ยอดบริการรวม</span>
          <strong className="t-h2 num" style={{ display: "block", marginTop: 6 }}>
            ฿{formatBaht(totalRevenue)}
          </strong>
        </div>
        <div className="stat-tile">
          <span className="t-caption">จำนวนครั้ง</span>
          <strong className="t-h2 num" style={{ display: "block", marginTop: 6 }}>
            {formatNumber(totalServices)}
          </strong>
        </div>
        <div className="stat-tile">
          <span className="t-caption">เวลาให้บริการรวม</span>
          <strong className="t-h2 num" style={{ display: "block", marginTop: 6 }}>
            {formatMinutes(totalMinutes)}
          </strong>
        </div>
        <div className="stat-tile">
          <span className="t-caption">พนักงานที่มีงานในช่วงนี้</span>
          <strong className="t-h2 num" style={{ display: "block", marginTop: 6 }}>
            {formatNumber(worked.length)} / {formatNumber(rows.length)}
          </strong>
        </div>
      </div>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            จัดอันดับตามยอด · <span className="num">{range.from}</span> ถึง <span className="num">{range.to}</span>
          </h2>
        </div>

        {rows.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>ยังไม่มีพนักงานนวดในร้าน</p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>พนักงาน</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอดบริการ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>จำนวนครั้ง</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>จำนวนบิล</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>เวลารวม</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>เฉลี่ย/ครั้ง</th>
                  <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>ประวัติ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.therapistId} style={{ borderTop: "1px solid var(--line)", opacity: row.isActive ? 1 : 0.6 }}>
                    <td style={{ padding: "12px 24px" }}>
                      {row.label}
                      {row.isActive ? null : <span className="t-caption"> (ปิดใช้งาน)</span>}
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right", fontWeight: 600 }}>
                      ฿{formatBaht(row.revenue)}
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>{formatNumber(row.services)}</td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>{formatNumber(row.bills)}</td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>{formatMinutes(row.minutes)}</td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                      {row.services > 0 ? `฿${formatBaht(row.revenue / row.services)}` : "—"}
                    </td>
                    <td style={{ padding: "12px 24px", textAlign: "right" }}>
                      <Link
                        href={`/spa/therapists/${row.therapistId}?from=${range.from}&to=${range.to}`}
                        className="btn btn-ghost btn-sm"
                      >
                        ดูรายการ
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
