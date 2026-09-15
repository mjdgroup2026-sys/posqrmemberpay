import { redirect } from "next/navigation"
import { requirePlatformAdmin } from "@/lib/session"
import { listStoresForAdmin } from "@/lib/admin-queries"
import { formatBaht, formatDate, formatDateTime } from "@/lib/format"
import { AdminStoreStatusButton } from "@/components/admin-store-status-button"
import { IconShield } from "@/components/icons"

export const metadata = { title: "ร้านค้าทั้งหมด" }

/// หน้าผู้ดูแลแพลตฟอร์ม (Phase 14a) — ไม่ผูกกับร้าน ทำงานได้แม้ผู้ดูแลไม่มี StoreMember เลย
/// อ่านอย่างเดียว: ระงับ/ปลดระงับได้ แต่ไม่แก้ข้อมูลในร้าน (ไม่มีลิงก์เข้าไปดูบิล/เมนูของร้านใด)
export default async function AdminStoresPage() {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    redirect(code === "UNAUTHENTICATED" ? "/login?callbackUrl=%2Fadmin%2Fstores" : "/access-denied?resource=PLATFORM")
  }

  const stores = await listStoresForAdmin()
  const active = stores.filter((s) => s.status === "ACTIVE").length
  const totalSales = stores.reduce((sum, s) => sum + s.totalSales, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">แพลตฟอร์ม</p>
          <h1 className="t-h1">
            <IconShield size={22} aria-hidden /> ร้านค้าทั้งหมด
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            ทุกร้านในระบบ — ระงับ/ปลดระงับได้ที่นี่ · ข้อมูลภายในร้านเป็นของเจ้าของร้าน ผู้ดูแลแพลตฟอร์มดูได้แค่ตัวเลขรวม
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div className="stat-tile">
          <span className="t-caption">ร้านทั้งหมด</span>
          <span className="t-h2 num">{stores.length}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">ใช้งานอยู่</span>
          <span className="t-h2 num">{active}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">ถูกระงับ</span>
          <span className="t-h2 num">{stores.length - active}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">ยอดขายรวมทุกร้าน</span>
          <span className="t-h2 num">{formatBaht(totalSales)}</span>
        </div>
      </div>

      <section className="card-ui">
        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>ร้าน</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>เจ้าของ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>สมาชิก</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>โต๊ะ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>บิล</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอดขายรวม</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ขายล่าสุด</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>สร้างเมื่อ</th>
                <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "12px 24px" }}>
                    <div style={{ fontWeight: 600 }}>{store.name}</div>
                    <div className="t-caption num">{store.slug}</div>
                  </td>
                  <td style={{ padding: "12px" }}>
                    <span className={`chip ${store.status === "ACTIVE" ? "chip-success" : "chip-danger"}`}>
                      <span className="dot" />
                      {store.status === "ACTIVE" ? "ใช้งานอยู่" : "ถูกระงับ"}
                    </span>
                  </td>
                  <td style={{ padding: "12px" }} className="t-small">
                    {store.ownerEmails.length > 0 ? store.ownerEmails.join(", ") : <span className="t-caption">— ไม่มีเจ้าของ</span>}
                  </td>
                  <td className="num" style={{ padding: "12px", textAlign: "right" }}>{store.memberCount}</td>
                  <td className="num" style={{ padding: "12px", textAlign: "right" }}>{store.tableCount}</td>
                  <td className="num" style={{ padding: "12px", textAlign: "right" }}>{store.saleCount}</td>
                  <td className="num" style={{ padding: "12px", textAlign: "right" }}>{formatBaht(store.totalSales)}</td>
                  <td className="num t-caption" style={{ padding: "12px", textAlign: "right" }}>
                    {store.lastSaleAt ? formatDateTime(store.lastSaleAt) : "—"}
                  </td>
                  <td className="num t-caption" style={{ padding: "12px", textAlign: "right" }}>{formatDate(store.createdAt)}</td>
                  <td style={{ padding: "12px 24px", textAlign: "right" }}>
                    <AdminStoreStatusButton storeId={store.id} status={store.status} storeName={store.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
