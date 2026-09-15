import { listProductOptions, listTransactions } from "@/lib/queries"
import { stockIn } from "@/app/actions/stock"
import { StockMoveForm } from "@/components/stock-move-form"
import { formatDateTime, formatNumber } from "@/lib/format"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "รับสินค้าเข้า" }

export default async function StockInPage() {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId } = await requirePageAccess("STOCK_IN")

  const [products, transactions] = await Promise.all([listProductOptions(storeId), listTransactions(storeId, 50)])
  const history = transactions.filter((t) => t.type === "IN").slice(0, 12)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">คลังสินค้า</p>
          <h1 className="t-h1">รับสินค้าเข้าคลัง</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            บันทึกการรับของเข้าคลัง ระบบจะเพิ่มยอดคงเหลือและบันทึกลง ledger พร้อมกันในทรานแซคชันเดียว
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 20, alignItems: "start" }}>
        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 16 }}>
            บันทึกรายการ
          </h2>
          <StockMoveForm products={products} action={stockIn} mode="in" />
        </section>

        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">ประวัติการรับเข้าล่าสุด</h2>
          </div>
          {history.length === 0 ? (
            <p className="t-body" style={{ padding: 24 }}>
              ยังไม่มีประวัติการรับสินค้าเข้า
            </p>
          ) : (
            <ul style={{ display: "flex", flexDirection: "column" }}>
              {history.map((t) => (
                <li
                  key={t.id}
                  className="row"
                  style={{ justifyContent: "space-between", padding: "12px 24px", borderTop: "1px solid var(--line)" }}
                >
                  <span>
                    <span style={{ fontWeight: 500 }}>{t.productName}</span>{" "}
                    <span className="t-caption num">({t.productSku})</span>
                    {t.note ? <span className="t-caption"> · {t.note}</span> : null}
                  </span>
                  <span className="row" style={{ gap: 14 }}>
                    <span className="t-small num" style={{ color: "var(--success)", fontWeight: 600 }}>
                      +{formatNumber(t.quantity)} {t.unit}
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
