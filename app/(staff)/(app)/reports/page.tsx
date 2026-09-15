import {
  getMovementReport,
  getTopMovedProducts,
  listTransactions,
  getSalesReport,
  getTopSellingProducts,
  getPaymentBreakdown,
} from "@/lib/queries"
import { MovementChart } from "@/components/movement-chart"
import { SalesChart } from "@/components/sales-chart"
import { formatBaht, formatDateTime, formatNumber } from "@/lib/format"
import { PAYMENT_METHOD_LABEL } from "@/lib/types"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "รายงาน" }

export default async function ReportsPage() {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId } = await requirePageAccess("REPORTS")

  const [movement, topProducts, transactions, sales, topSelling, payments] = await Promise.all([
    getMovementReport(storeId),
    getTopMovedProducts(storeId, 5),
    listTransactions(storeId, 20),
    getSalesReport(storeId),
    getTopSellingProducts(storeId, 5),
    getPaymentBreakdown(storeId),
  ])

  const totalIn = movement.reduce((sum, d) => sum + d.stockIn, 0)
  const totalOut = movement.reduce((sum, d) => sum + d.stockOut, 0)
  const salesTotal = sales.reduce((sum, d) => sum + d.total, 0)
  const billTotal = sales.reduce((sum, d) => sum + d.bills, 0)
  const paymentTotal = payments.reduce((sum, p) => sum + p.total, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">รายงาน</p>
          <h1 className="t-h1">สรุปยอดขายและการเคลื่อนไหว 30 วัน</h1>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <article className="stat-tile">
          <span className="t-caption">ยอดขายรวม 30 วัน</span>
          <strong className="t-h1 num">฿{formatBaht(salesTotal)}</strong>
          <span className="t-caption num">{formatNumber(billTotal)} บิล (ไม่รวมบิลที่ยกเลิก)</span>
        </article>
        <article className="stat-tile">
          <span className="t-caption">ยอดขายเฉลี่ยต่อบิล</span>
          <strong className="t-h1 num">
            ฿{formatBaht(billTotal === 0 ? 0 : salesTotal / billTotal)}
          </strong>
        </article>
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
          <h2 className="t-h2">กราฟยอดขายรายวัน</h2>
        </div>
        <SalesChart data={sales} />
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">รายการขายดี 30 วัน</h2>
          </div>
          {topSelling.length === 0 ? (
            <p className="t-body" style={{ padding: 24 }}>
              ยังไม่มีข้อมูลการขาย
            </p>
          ) : (
            <ol style={{ display: "flex", flexDirection: "column" }}>
              {topSelling.map((p, index) => (
                <li
                  key={`${p.name}|${p.sku}`}
                  className="row"
                  style={{ justifyContent: "space-between", padding: "12px 24px", borderTop: "1px solid var(--line)" }}
                >
                  <span className="row" style={{ gap: 10 }}>
                    <span className="chip chip-brand num">{index + 1}</span>
                    <span>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>{" "}
                      {/* เมนูของ MJD Mobile Order ไม่มี SKU — แสดงช่องทางแทนเพื่อไม่ให้เห็นวงเล็บว่าง */}
                      <span className="t-caption num">({p.sku || "Mobile Order"})</span>
                    </span>
                  </span>
                  <span className="row" style={{ gap: 12 }}>
                    <span className="t-small num">{formatNumber(p.quantity)} ชิ้น</span>
                    <span className="t-small num" style={{ fontWeight: 600 }}>
                      ฿{formatBaht(p.revenue)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">สัดส่วนวิธีชำระเงิน</h2>
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
      </div>

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
