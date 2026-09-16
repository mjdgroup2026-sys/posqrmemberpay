import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { listBrandStores } from "@/lib/brand-queries"
import { getOpenSessionCount, getSalesReport } from "@/lib/queries"
import { formatBaht } from "@/lib/format"
import { IconBack, IconReports } from "@/components/icons"

export const metadata = { title: "รายงานรวมแบรนด์" }

/// รายงานรวมแบรนด์ (Phase 14c) — **อ่านอย่างเดียว** และ**ไม่มี query ข้ามร้านใหม่**: เรียก query เดิมของ lib/queries.ts
/// ซ้ำต่อ storeId (ทุกตัวผ่าน forStore) แล้วรวมในโค้ด — รายชื่อสาขามาจาก listBrandStores() ที่กรอง brand.ownerId
export default async function BrandReportsPage() {
  const session = await getSession()
  if (!session?.user) redirect("/login?callbackUrl=%2Fbrand%2Freports")

  const stores = await listBrandStores(session.user.id)
  if (stores.length === 0) redirect("/brand")

  const rows = await Promise.all(
    stores.map(async (store) => {
      const [report, openTables] = await Promise.all([getSalesReport(store.id), getOpenSessionCount(store.id)])
      const total = report.reduce((sum, r) => sum + r.total, 0)
      const bills = report.reduce((sum, r) => sum + r.bills, 0)
      return { store, total, bills, avg: bills > 0 ? total / bills : 0, openTables, days: report.length }
    }),
  )
  const grand = rows.reduce((acc, r) => ({ total: acc.total + r.total, bills: acc.bills + r.bills, openTables: acc.openTables + r.openTables }), {
    total: 0,
    bills: 0,
    openTables: 0,
  })
  const best = rows.reduce((top, r) => (r.total > (top?.total ?? -1) ? r : top), rows[0])

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href="/brand" className="row" style={{ gap: 4, display: "inline-flex" }}>
              <IconBack size={14} aria-hidden /> แบรนด์
            </Link>
          </p>
          <h1 className="t-h1">
            <IconReports size={22} aria-hidden /> รายงานรวมแบรนด์
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            ยอดขาย 30 วันล่าสุดของทุกสาขาเทียบกัน (เฉพาะบิลที่ปิดสำเร็จ ทั้ง POS และ Mobile Order) — รายละเอียดรายสาขาดูได้ที่
            หน้า รายงาน ของสาขานั้นหลังสลับร้าน
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div className="stat-tile">
          <span className="t-caption">ยอดขายรวม 30 วัน</span>
          <span className="t-h2 num">{formatBaht(grand.total)}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">จำนวนบิลรวม</span>
          <span className="t-h2 num">{grand.bills.toLocaleString("th-TH")}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">เฉลี่ยต่อบิล</span>
          <span className="t-h2 num">{formatBaht(grand.bills > 0 ? grand.total / grand.bills : 0)}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">โต๊ะที่เปิดอยู่ตอนนี้</span>
          <span className="t-h2 num">{grand.openTables}</span>
        </div>
      </div>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">รายสาขา</h2>
          {best && best.total > 0 ? (
            <span className="t-caption">
              สาขาที่ยอดสูงสุด: <strong>{best.store.name}</strong>
            </span>
          ) : null}
        </div>
        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>สาขา</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอดขาย 30 วัน</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>สัดส่วน</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>บิล</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>เฉลี่ย/บิล</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>วันที่มียอด</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>โต๊ะเปิดอยู่</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const share = grand.total > 0 ? (r.total / grand.total) * 100 : 0
                return (
                  <tr key={r.store.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 24px" }}>
                      <strong>{r.store.name}</strong>
                      <div className="t-caption num">/{r.store.slug}</div>
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>
                      {formatBaht(r.total)}
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                      <span
                        aria-hidden
                        style={{
                          display: "inline-block",
                          width: 80,
                          height: 6,
                          borderRadius: 3,
                          background: "var(--surface-2)",
                          verticalAlign: "middle",
                          marginRight: 8,
                          overflow: "hidden",
                        }}
                      >
                        <span style={{ display: "block", width: `${share}%`, height: "100%", background: "var(--brand)" }} />
                      </span>
                      {share.toFixed(1)}%
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                      {r.bills.toLocaleString("th-TH")}
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                      {formatBaht(r.avg)}
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                      {r.days}
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                      {r.openTables}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                <td style={{ padding: "10px 24px" }}>รวม {rows.length} สาขา</td>
                <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                  {formatBaht(grand.total)}
                </td>
                <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                  100%
                </td>
                <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                  {grand.bills.toLocaleString("th-TH")}
                </td>
                <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                  {formatBaht(grand.bills > 0 ? grand.total / grand.bills : 0)}
                </td>
                <td />
                <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                  {grand.openTables}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  )
}
