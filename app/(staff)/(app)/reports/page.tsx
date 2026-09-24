import Link from "next/link"
import {
  getMovementReport,
  getTopMovedProducts,
  listTransactions,
  getPaymentBreakdown,
  getSalesByKind,
  getStoreSettings,
  getTopItemsByKind,
  type SaleKind,
} from "@/lib/queries"
import { MovementChart } from "@/components/movement-chart"
import { SALE_KIND_SERIES, SalesKindChart } from "@/components/sales-kind-chart"
import { DayRangePicker } from "@/components/day-range-picker"
import { IconDownload } from "@/components/icons"
import { businessDayKey, resolveDayRange } from "@/lib/day"
import { formatBaht, formatDateTime, formatNumber } from "@/lib/format"
import { PAYMENT_METHOD_LABEL } from "@/lib/types"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "รายงาน" }

/// รายงานหลัก — ยอดขายแยกประเภท อาหาร / นวดสปา / สินค้าหน้าร้าน ตามช่วงวันที่เลือก (20e) + การเคลื่อนไหวสต็อก 30 วัน
///
/// ยอดแต่ละประเภท = ราคารายการจริง · ส่วนลด/ค่าบริการท้ายบิลเป็นแถวแยก (เจ้าของเลือก 2026-09-24)
/// บวกกันแล้วต้องเท่ายอดขายสุทธิพอดี — ตัวเลขชุดนี้มาจาก getSalesByKind ตัวเดียวกับการ์ดบนรายงานสปา
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId } = await requirePageAccess("REPORTS")

  const query = await searchParams
  const range = resolveDayRange(query.from, query.to)

  const [movement, topProducts, transactions, byKind, payments, settings, topFood, topService, topProduct] = await Promise.all([
    getMovementReport(storeId),
    getTopMovedProducts(storeId, 5),
    listTransactions(storeId, 20),
    getSalesByKind(storeId, range),
    getPaymentBreakdown(storeId, range),
    getStoreSettings(storeId),
    getTopItemsByKind(storeId, range, "FOOD", 5),
    getTopItemsByKind(storeId, range, "SERVICE", 5),
    getTopItemsByKind(storeId, range, "PRODUCT", 5),
  ])

  // ประเภทนวดโชว์เมื่อร้านเปิดสปา หรือเคยมียอดนวดในช่วงนี้ (ร้านที่ปิดสปาไปแล้วยังต้องเห็นยอดเก่า)
  const kinds: SaleKind[] = SALE_KIND_SERIES.map((s) => s.kind).filter(
    (kind) => kind !== "SERVICE" || settings?.spaEnabled || byKind.kinds.SERVICE.revenue > 0,
  )
  const topByKind: Record<SaleKind, typeof topFood> = { FOOD: topFood, SERVICE: topService, PRODUCT: topProduct }

  const totalIn = movement.reduce((sum, d) => sum + d.stockIn, 0)
  const totalOut = movement.reduce((sum, d) => sum + d.stockOut, 0)
  const paymentTotal = payments.reduce((sum, p) => sum + p.total, 0)
  const exportHref = (kind?: SaleKind) =>
    `/api/reports/sales-csv?${new URLSearchParams({ from: range.from, to: range.to, ...(kind ? { kind } : {}) }).toString()}`

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">รายงาน</p>
          <h1 className="t-h1">ยอดขายแยกประเภท</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            <span className="num">{range.from}</span> ถึง <span className="num">{range.to}</span> · นับเฉพาะบิลที่ปิดแล้ว (ไม่รวมบิลที่ยกเลิก)
          </p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <DayRangePicker basePath="/reports" from={range.from} to={range.to} today={businessDayKey()} />
          <a href={exportHref()} className="btn btn-subtle" download>
            <IconDownload size={17} aria-hidden />
            ดาวน์โหลด CSV
          </a>
        </div>
      </div>

      {/* ยอดแต่ละประเภท + แถวปรับท้ายบิล → รวมเป็นยอดสุทธิ */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        {SALE_KIND_SERIES.filter((s) => kinds.includes(s.kind)).map((s) => (
          <article key={s.kind} className="stat-tile" style={{ borderTop: `4px solid ${s.color}` }}>
            <span className="t-caption">{s.label}</span>
            <strong className="t-h1 num">฿{formatBaht(byKind.kinds[s.kind].revenue)}</strong>
            <span className="t-caption num">
              {formatNumber(byKind.kinds[s.kind].quantity)} รายการ · {formatNumber(byKind.kinds[s.kind].bills)} บิล
            </span>
          </article>
        ))}
        <article className="stat-tile">
          <span className="t-caption">ค่าบริการ − ส่วนลด (ท้ายบิล)</span>
          <strong className="t-h1 num">
            {byKind.serviceCharge - byKind.discount < 0 ? "−" : "+"}฿{formatBaht(Math.abs(byKind.serviceCharge - byKind.discount))}
          </strong>
          <span className="t-caption num">
            ค่าบริการ ฿{formatBaht(byKind.serviceCharge)} · ส่วนลด ฿{formatBaht(byKind.discount)}
          </span>
        </article>
        <article className="stat-tile">
          <span className="t-caption">ยอดขายสุทธิ</span>
          <strong className="t-h1 num">฿{formatBaht(byKind.grandTotal)}</strong>
          <span className="t-caption num">
            {formatNumber(byKind.bills)} บิล · เฉลี่ย ฿{formatBaht(byKind.bills === 0 ? 0 : byKind.grandTotal / byKind.bills)}/บิล
          </span>
        </article>
      </section>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">ยอดขายรายวันแยกประเภท</h2>
        </div>
        <SalesKindChart data={byKind.daily} kinds={kinds} />
        {/* ตัวเลขชุดเดียวกับกราฟ — อ่านได้โดยไม่พึ่งสี และคัดลอกไปใช้ต่อได้ */}
        <details style={{ padding: "0 24px 16px" }}>
          <summary className="t-small" style={{ cursor: "pointer", padding: "8px 0" }}>
            ดูเป็นตาราง
          </summary>
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500 }}>วันที่</th>
                  {SALE_KIND_SERIES.filter((s) => kinds.includes(s.kind)).map((s) => (
                    <th key={s.kind} style={{ padding: "8px 12px", fontWeight: 500 }}>
                      {s.label}
                    </th>
                  ))}
                  <th style={{ padding: "8px 12px", fontWeight: 500 }}>ค่าบริการ − ส่วนลด</th>
                  <th style={{ padding: "8px 12px", fontWeight: 500 }}>สุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {byKind.daily
                  .filter((d) => d.total !== 0 || d.FOOD + d.SERVICE + d.PRODUCT !== 0)
                  .map((d) => (
                    <tr key={d.day} style={{ borderTop: "1px solid var(--line)", textAlign: "right" }}>
                      <td className="num" style={{ padding: "8px 12px", textAlign: "left" }}>
                        {d.day}
                      </td>
                      {SALE_KIND_SERIES.filter((s) => kinds.includes(s.kind)).map((s) => (
                        <td key={s.kind} className="num" style={{ padding: "8px 12px" }}>
                          {formatBaht(d[s.kind])}
                        </td>
                      ))}
                      <td className="num" style={{ padding: "8px 12px" }}>
                        {formatBaht(d.adjustments)}
                      </td>
                      <td className="num" style={{ padding: "8px 12px", fontWeight: 600 }}>
                        {formatBaht(d.total)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* ขายดีแยกประเภท — วางคู่กันเพื่อเทียบได้ในจอเดียว */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
        {SALE_KIND_SERIES.filter((s) => kinds.includes(s.kind)).map((s) => (
          <section key={s.kind} className="card-ui">
            <div className="panel-head">
              <h2 className="t-h2 row" style={{ gap: 8 }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
                ขายดี · {s.label}
              </h2>
              <a href={exportHref(s.kind)} className="btn btn-ghost btn-sm" download title={`ดาวน์โหลด CSV เฉพาะ${s.label}`}>
                <IconDownload size={15} aria-hidden />
                CSV
              </a>
            </div>
            {topByKind[s.kind].length === 0 ? (
              <p className="t-body" style={{ padding: 24 }}>
                ยังไม่มียอดในช่วงนี้
              </p>
            ) : (
              <ol style={{ display: "flex", flexDirection: "column" }}>
                {topByKind[s.kind].map((item, index) => (
                  <li
                    key={item.name}
                    className="row"
                    style={{ justifyContent: "space-between", padding: "12px 24px", borderTop: "1px solid var(--line)" }}
                  >
                    <span className="row" style={{ gap: 10 }}>
                      <span className="chip chip-neutral num">{index + 1}</span>
                      <span style={{ fontWeight: 500 }}>{item.name}</span>
                    </span>
                    <span className="row" style={{ gap: 12 }}>
                      <span className="t-small num">{formatNumber(item.quantity)}</span>
                      <span className="t-small num" style={{ fontWeight: 600 }}>
                        ฿{formatBaht(item.revenue)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">สัดส่วนวิธีชำระเงิน</h2>
          {settings?.spaEnabled ? (
            <Link href={`/spa/reports?from=${range.from}&to=${range.to}`} className="btn btn-ghost btn-sm">
              รายงานพนักงานนวด
            </Link>
          ) : null}
        </div>
        {payments.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ยังไม่มีข้อมูลการชำระเงิน
          </p>
        ) : (
          <ul style={{ display: "flex", flexDirection: "column" }}>
            {payments.map((p) => {
              const share = paymentTotal === 0 ? 0 : Math.round((p.total / paymentTotal) * 100)
              return (
                <li
                  key={p.paymentMethod}
                  style={{ padding: "12px 24px", borderTop: "1px solid var(--line)", display: "grid", gap: 6 }}
                >
                  <span className="row" style={{ justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 500 }}>{PAYMENT_METHOD_LABEL[p.paymentMethod]}</span>
                    <span className="t-small num">
                      ฿{formatBaht(p.total)} · {formatNumber(p.bills)} บิล · {share}%
                    </span>
                  </span>
                  <span
                    aria-hidden
                    style={{ height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}
                  >
                    <span
                      style={{ display: "block", width: share + "%", height: "100%", background: "var(--brand)" }}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="page-head" style={{ marginTop: 12 }}>
        <div>
          <p className="t-eyebrow">คลังสินค้า</p>
          <h2 className="t-h2">การเคลื่อนไหวสต็อก 30 วัน</h2>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <article className="stat-tile">
          <span className="t-caption">รับเข้ารวม 30 วัน</span>
          <strong className="t-h1 num" style={{ color: "var(--success)" }}>
            +{formatNumber(totalIn)}
          </strong>
        </article>
        <article className="stat-tile">
          <span className="t-caption">เบิกออกรวม 30 วัน</span>
          <strong className="t-h1 num" style={{ color: "var(--info)" }}>
            −{formatNumber(totalOut)}
          </strong>
        </article>
        <article className="stat-tile">
          <span className="t-caption">สุทธิ</span>
          <strong className="t-h1 num">{formatNumber(totalIn - totalOut)}</strong>
        </article>
      </section>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">กราฟการเคลื่อนไหวสต็อกรายวัน</h2>
        </div>
        <MovementChart data={movement} />
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">สินค้าเบิกออกมากที่สุด</h2>
          </div>
          {topProducts.length === 0 ? (
            <p className="t-body" style={{ padding: 24 }}>
              ยังไม่มีข้อมูลการเบิกจ่าย
            </p>
          ) : (
            <ol style={{ display: "flex", flexDirection: "column" }}>
              {topProducts.map((p, index) => (
                <li
                  key={p.sku}
                  className="row"
                  style={{ justifyContent: "space-between", padding: "12px 24px", borderTop: "1px solid var(--line)" }}
                >
                  <span className="row" style={{ gap: 10 }}>
                    <span className="chip chip-brand num">{index + 1}</span>
                    <span>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>{" "}
                      <span className="t-caption num">({p.sku})</span>
                    </span>
                  </span>
                  <span className="t-small num" style={{ fontWeight: 600 }}>
                    {formatNumber(p.total)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">รายการล่าสุด</h2>
          </div>
          {transactions.length === 0 ? (
            <p className="t-body" style={{ padding: 24 }}>
              ยังไม่มีรายการเคลื่อนไหว
            </p>
          ) : (
            <ul style={{ display: "flex", flexDirection: "column", maxHeight: 380, overflowY: "auto" }}>
              {transactions.map((t) => (
                <li
                  key={t.id}
                  className="row"
                  style={{ justifyContent: "space-between", padding: "10px 24px", borderTop: "1px solid var(--line)" }}
                >
                  <span className="row" style={{ gap: 8 }}>
                    <span className={`chip ${t.type === "IN" ? "chip-success" : "chip-info"}`}>
                      <span className="dot" />
                      {t.type === "IN" ? "เข้า" : "ออก"}
                    </span>
                    <span className="t-small">{t.productName}</span>
                  </span>
                  <span className="row" style={{ gap: 12 }}>
                    <span className="t-small num">
                      {t.type === "IN" ? "+" : "−"}
                      {formatNumber(t.quantity)}
                    </span>
                    <span className="t-caption num">{formatDateTime(t.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
