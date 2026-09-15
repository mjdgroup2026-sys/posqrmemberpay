import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { getTodaySalesSummary, getTodayClosing, listClosings } from "@/lib/queries"
import { formatBaht, formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { ClosingForm } from "@/components/closing-form"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "ปิดยอดประจำวัน" }

export default async function ClosingPage() {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId } = await requirePageAccess("POS_CLOSING")

  const session = await getSession()
  if (!session?.user) redirect("/login")

  const cashierId = session.user.id
  const [summary, today, history] = await Promise.all([
    getTodaySalesSummary(storeId, cashierId),
    getTodayClosing(storeId, cashierId),
    listClosings(storeId, { cashierId, limit: 30 }),
  ])

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ขายหน้าร้าน</p>
          <h1 className="t-h1">ปิดยอดประจำวัน</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            สรุปยอดของ {session.user.name} สำหรับวันนี้ — คำนวณอัตโนมัติจากบิลจริง ไม่ต้องกรอกเอง
          </p>
        </div>
      </div>

      <section
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}
      >
        <article className="stat-tile">
          <span className="t-caption">ยอดขายรวมวันนี้</span>
          <strong className="t-h1 num">฿{formatBaht(summary.totalSales)}</strong>
          <span className="t-caption num">{formatNumber(summary.billCount)} บิล</span>
        </article>
        <article className="stat-tile">
          <span className="t-caption">เงินสด</span>
          <strong className="t-h1 num">฿{formatBaht(summary.totalCash)}</strong>
          <span className="t-caption">ยอดที่ต้องมีในลิ้นชัก</span>
        </article>
        <article className="stat-tile">
          <span className="t-caption">โอนเงิน</span>
          <strong className="t-h1 num">฿{formatBaht(summary.totalTransfer)}</strong>
        </article>
        <article className="stat-tile">
          <span className="t-caption">สแกน QR</span>
          <strong className="t-h1 num">฿{formatBaht(summary.totalQR)}</strong>
        </article>
        <article className="stat-tile">
          <span className="t-caption">พร้อมเพย์/บัตร</span>
          <strong className="t-h1 num">฿{formatBaht(summary.totalCard)}</strong>
          <span className="t-caption">บิลจาก MJD Mobile Order</span>
        </article>
        <article className="stat-tile">
          <span className="t-caption">บิลที่ถูกยกเลิกวันนี้</span>
          <strong className="t-h1 num" style={{ color: summary.voidedCount > 0 ? "var(--danger)" : undefined }}>
            {formatNumber(summary.voidedCount)}
          </strong>
        </article>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 20, alignItems: "start" }}>
        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 16 }}>
            {today ? "ผลการปิดยอดวันนี้" : "นับเงินและปิดยอด"}
          </h2>

          {today ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="alert-banner info">
                ปิดยอดของวันนี้เรียบร้อยแล้วเมื่อ {formatDateTime(today.closedAt)} — แก้ไขไม่ได้
              </div>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="t-small">ยอดขายรวม</span>
                <span className="num">฿{formatBaht(today.totalSales)}</span>
              </span>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="t-small">ยอดเงินสดตามระบบ</span>
                <span className="num">฿{formatBaht(today.totalCash)}</span>
              </span>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="t-small">พร้อมเพย์/บัตร</span>
                <span className="num">฿{formatBaht(today.totalCard)}</span>
              </span>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="t-small">เงินสดที่นับได้</span>
                <span className="num">฿{formatBaht(today.countedCash)}</span>
              </span>
              <span className="row" style={{ justifyContent: "space-between", fontWeight: 700 }}>
                <span className="t-small">ส่วนต่าง</span>
                <span
                  className="num"
                  style={{
                    color:
                      today.difference === 0
                        ? undefined
                        : today.difference > 0
                          ? "var(--success)"
                          : "var(--danger)",
                  }}
                >
                  {today.difference > 0 ? "+" : ""}
                  {formatBaht(today.difference)}
                </span>
              </span>
              {today.note ? <p className="t-caption">หมายเหตุ: {today.note}</p> : null}
            </div>
          ) : (
            <ClosingForm summary={summary} />
          )}
        </section>

        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">ประวัติการปิดยอด</h2>
          </div>
          {history.length === 0 ? (
            <p className="t-body" style={{ padding: 24 }}>
              ยังไม่มีประวัติการปิดยอด
            </p>
          ) : (
            <div className="datatable-wrap">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                    <th style={{ padding: "10px 24px", fontWeight: 500 }}>วันที่</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอดขาย</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>เงินสดระบบ</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>นับได้</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ส่วนต่าง</th>
                    <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>บิล</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="num" style={{ padding: "12px 24px" }}>
                        {formatDate(row.closingDate)}
                      </td>
                      <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                        ฿{formatBaht(row.totalSales)}
                      </td>
                      <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                        ฿{formatBaht(row.totalCash)}
                      </td>
                      <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                        ฿{formatBaht(row.countedCash)}
                      </td>
                      <td
                        className="num"
                        style={{
                          padding: "12px",
                          textAlign: "right",
                          fontWeight: 600,
                          color:
                            row.difference === 0
                              ? undefined
                              : row.difference > 0
                                ? "var(--success)"
                                : "var(--danger)",
                        }}
                      >
                        {row.difference > 0 ? "+" : ""}
                        {formatBaht(row.difference)}
                      </td>
                      <td className="num t-caption" style={{ padding: "12px 24px", textAlign: "right" }}>
                        {formatNumber(row.billCount)} / ยกเลิก {formatNumber(row.voidedCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
