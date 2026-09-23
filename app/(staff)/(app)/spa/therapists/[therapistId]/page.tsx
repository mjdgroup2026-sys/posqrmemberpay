import Link from "next/link"
import { notFound } from "next/navigation"
import { getTherapistById, getTherapistHistory, getTherapistSalesReport } from "@/lib/queries"
import { businessDayKey, resolveDayRange } from "@/lib/day"
import { formatBaht, formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { requirePageAccess } from "@/lib/permissions"
import { DayRangePicker } from "@/components/day-range-picker"
import { IconBack } from "@/components/icons"

export const metadata = { title: "ประวัติพนักงานนวด" }

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${formatNumber(minutes)} นาที`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${formatNumber(hours)} ชม.` : `${formatNumber(hours)} ชม. ${rest} น.`
}

/// ประวัติการให้บริการรายคน (Phase 20c) — สรุปของช่วงที่เลือก + รายการรายบรรทัดจากบิลจริง
export default async function TherapistHistoryPage({ params, searchParams }: PageProps<"/spa/therapists/[therapistId]">) {
  const { storeId } = await requirePageAccess("SPA_THERAPISTS", "REPORTS")
  const { therapistId } = await params
  const query = await searchParams
  const range = resolveDayRange(query.from, query.to)

  // id จากผู้ใช้ — อ่านใต้ร้านนี้เท่านั้น ของร้านอื่นจึงหาไม่เจอ (กติกาข้อ 5)
  const therapist = await getTherapistById(storeId, therapistId)
  if (!therapist) notFound()

  const [summary, history] = await Promise.all([
    getTherapistSalesReport(storeId, range),
    getTherapistHistory(storeId, therapistId, range),
  ])
  const mine = summary.find((row) => row.therapistId === therapistId)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href="/spa/reports" className="row" style={{ gap: 6 }}>
              <IconBack size={14} aria-hidden />
              รายงานพนักงานนวด
            </Link>
          </p>
          <h1 className="t-h1">
            <span className="num">{therapist.code}</span> {therapist.nickname ?? therapist.name}
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            {therapist.skills.length > 0 ? `ทักษะ: ${therapist.skills.map((s) => s.name).join(", ")} · ` : ""}
            {therapist.startedAt ? `เริ่มงาน ${formatDate(therapist.startedAt)} · ` : ""}
            ให้บริการสะสมทั้งหมด {formatNumber(therapist.servedCount)} ครั้ง
            {therapist.isActive ? "" : " · ปิดใช้งานอยู่"}
          </p>
        </div>
        <DayRangePicker
          basePath={`/spa/therapists/${therapistId}`}
          from={range.from}
          to={range.to}
          today={businessDayKey()}
        />
      </div>

      <div className="field-grid" style={{ marginBottom: 18 }}>
        <div className="stat-tile">
          <span className="t-caption">ยอดบริการในช่วงนี้</span>
          <strong className="t-h2 num" style={{ display: "block", marginTop: 6 }}>
            ฿{formatBaht(mine?.revenue ?? 0)}
          </strong>
        </div>
        <div className="stat-tile">
          <span className="t-caption">จำนวนครั้ง</span>
          <strong className="t-h2 num" style={{ display: "block", marginTop: 6 }}>
            {formatNumber(mine?.services ?? 0)}
          </strong>
        </div>
        <div className="stat-tile">
          <span className="t-caption">เวลาให้บริการ</span>
          <strong className="t-h2 num" style={{ display: "block", marginTop: 6 }}>
            {formatMinutes(mine?.minutes ?? 0)}
          </strong>
        </div>
        <div className="stat-tile">
          <span className="t-caption">จำนวนบิล</span>
          <strong className="t-h2 num" style={{ display: "block", marginTop: 6 }}>
            {formatNumber(mine?.bills ?? 0)}
          </strong>
        </div>
      </div>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            รายการที่ให้บริการ · <span className="num">{range.from}</span> ถึง <span className="num">{range.to}</span>
          </h2>
          <span className="t-caption">แสดงล่าสุดไม่เกิน 200 รายการ</span>
        </div>

        {history.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>ไม่มีรายการในช่วงวันที่เลือก</p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>วันเวลา</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>บิล</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>โปรแกรม</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>ห้อง/โต๊ะ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>เวลา</th>
                  <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>ยอด</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, index) => (
                  <tr key={`${row.saleId}-${index}`} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="num" style={{ padding: "12px 24px" }}>{formatDateTime(row.soldAt)}</td>
                    <td className="num" style={{ padding: "12px" }}>{row.saleNumber}</td>
                    <td style={{ padding: "12px" }}>
                      {row.menuItemName}
                      {row.quantity > 1 ? <span className="t-caption num"> × {row.quantity}</span> : null}
                    </td>
                    <td className="t-caption num" style={{ padding: "12px" }}>{row.tableCode ?? "—"}</td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>{formatMinutes(row.minutes)}</td>
                    <td className="num" style={{ padding: "12px 24px", textAlign: "right", fontWeight: 600 }}>
                      ฿{formatBaht(row.subtotal)}
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
