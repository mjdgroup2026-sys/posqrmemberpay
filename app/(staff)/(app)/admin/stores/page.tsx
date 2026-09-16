import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePlatformAdmin } from "@/lib/session"
import { listPendingBatchesForAdmin, listPendingSubscriptionsForAdmin, listStoresWithPlanForAdmin, type AdminStoreFilter } from "@/lib/admin-queries"
import { remainingDays } from "@/lib/subscription"
import { formatBaht, formatDate, formatDateTime } from "@/lib/format"
import { AdminStoreStatusButton } from "@/components/admin-store-status-button"
import { IconShield } from "@/components/icons"

export const metadata = { title: "ร้านค้าทั้งหมด" }

const FILTERS: { key: AdminStoreFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "pending", label: "รอยืนยันเงิน" },
  { key: "expiring", label: "ใกล้หมด ≤ 7 วัน" },
  { key: "expired", label: "หมดแล้ว / ยังไม่เปิด" },
  { key: "full", label: "โต๊ะเต็มเพดาน" },
  { key: "suspended", label: "ถูกระงับ" },
]

function isFilter(value: unknown): value is AdminStoreFilter {
  return typeof value === "string" && FILTERS.some((f) => f.key === value)
}

/// หน้าผู้ดูแลแพลตฟอร์ม (Phase 14a + 14b) — ไม่ผูกกับร้าน ทำงานได้แม้ผู้ดูแลไม่มี StoreMember เลย
/// อ่านอย่างเดียว + ระงับ/ปลด · รายละเอียดค่าใช้งานต่อร้านอยู่ที่ /admin/stores/[id]
export default async function AdminStoresPage({ searchParams }: PageProps<"/admin/stores">) {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    redirect(code === "UNAUTHENTICATED" ? "/login?callbackUrl=%2Fadmin%2Fstores" : "/access-denied?resource=PLATFORM")
  }

  const params = await searchParams
  const filter: AdminStoreFilter = isFilter(params.filter) ? params.filter : "all"
  const [stores, pendings, pendingBatches] = await Promise.all([
    listStoresWithPlanForAdmin(filter),
    listPendingSubscriptionsForAdmin(),
    listPendingBatchesForAdmin(),
  ])
  const now = new Date()
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
            ทุกร้านในระบบ — ระงับ/ปลดระงับ และจัดการค่าใช้งานได้ที่นี่ · ข้อมูลภายในร้านเป็นของเจ้าของร้าน ผู้ดูแลดูได้แค่ตัวเลขรวม
          </p>
        </div>
        <Link href="/admin/plans" className="btn btn-subtle">
          แพ็กเกจค่าใช้งาน
        </Link>
      </div>

      {pendings.length > 0 || pendingBatches.length > 0 ? (
        <section className="card-ui card-pad" style={{ borderColor: "var(--brand)" }}>
          <h2 className="t-h2">
            รอยืนยันเงินเข้า <span className="num">{pendings.length + pendingBatches.length}</span> รายการ
          </h2>
          <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {/* ใบจ่ายรวมของแบรนด์ (Phase 14c) — ยืนยันทั้งใบที่หน้าใบ ไม่ใช่รายสาขา */}
            {pendingBatches.map((b) => (
              <li key={b.id} className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span>
                  <strong>แบรนด์ {b.brandName}</strong> · ใบจ่ายรวม {b.storeCount} สาขา · <span className="num">{b.requestRef}</span> ·{" "}
                  <span className="num">{formatBaht(b.amount)}</span>
                  <span className="t-caption"> · ขอเมื่อ {formatDateTime(b.createdAt)}</span>
                </span>
                <Link href={`/admin/batches/${b.id}`} className="btn btn-primary btn-sm">
                  ไปยืนยันทั้งใบ
                </Link>
              </li>
            ))}
            {pendings.map((p) => (
              <li key={p.id} className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span>
                  <strong>{p.storeName}</strong> · {p.kind === "UPGRADE" ? "อัปเกรด" : "ต่ออายุ"} {p.tier} {p.days} วัน ·{" "}
                  <span className="num">{p.requestRef}</span> · <span className="num">{formatBaht(p.amount)}</span>
                  <span className="t-caption"> · ขอเมื่อ {formatDateTime(p.createdAt)}</span>
                </span>
                <Link href={`/admin/stores/${p.storeId}`} className="btn btn-primary btn-sm">
                  ไปยืนยัน
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div className="stat-tile">
          <span className="t-caption">ร้านในมุมมองนี้</span>
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
          <span className="t-caption">ยอดขายรวม</span>
          <span className="t-h2 num">{formatBaht(totalSales)}</span>
        </div>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key === "all" ? "/admin/stores" : `/admin/stores?filter=${f.key}`} className={`btn btn-sm ${filter === f.key ? "btn-primary" : "btn-subtle"}`}>
            {f.label}
          </Link>
        ))}
      </div>

      <section className="card-ui">
        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>ร้าน</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>แพ็กเกจ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>โต๊ะ/เพดาน</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>เจ้าของ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>บิล</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอดขายรวม</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>สร้างเมื่อ</th>
                <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => {
                const left = remainingDays(now, store.planExpiresAt)
                const planChip = !store.planExpiresAt
                  ? { cls: "chip-danger", label: "ยังไม่เปิด" }
                  : left <= 0
                    ? { cls: "chip-danger", label: "หมดอายุ" }
                    : left <= 7
                      ? { cls: "chip-warning", label: `${store.planTier} · ${left} วัน` }
                      : { cls: "chip-success", label: `${store.planTier} · ${left > 3650 ? "ไม่หมดอายุ" : `${left} วัน`}` }
                return (
                  <tr key={store.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "12px 24px" }}>
                      <Link href={`/admin/stores/${store.id}`} style={{ fontWeight: 600, color: "var(--brand)" }}>
                        {store.name}
                      </Link>
                      <div className="t-caption num">{store.slug}</div>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span className={`chip ${store.status === "ACTIVE" ? "chip-success" : "chip-danger"}`}>
                        <span className="dot" />
                        {store.status === "ACTIVE" ? "ใช้งานอยู่" : "ถูกระงับ"}
                      </span>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span className={`chip ${planChip.cls}`}>
                        <span className="dot" />
                        {planChip.label}
                      </span>
                      {store.pendingCount > 0 ? <div className="t-caption">รอยืนยัน {store.pendingCount}</div> : null}
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right", color: store.tableCount >= store.tableLimit ? "var(--danger)" : undefined }}>
                      {store.tableCount} / {store.tableLimit}
                    </td>
                    <td style={{ padding: "12px" }} className="t-small">
                      {store.ownerEmails.length > 0 ? store.ownerEmails.join(", ") : <span className="t-caption">— ไม่มีเจ้าของ</span>}
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>{store.saleCount}</td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>{formatBaht(store.totalSales)}</td>
                    <td className="num t-caption" style={{ padding: "12px", textAlign: "right" }}>{formatDate(store.createdAt)}</td>
                    <td style={{ padding: "12px 24px", textAlign: "right" }}>
                      <AdminStoreStatusButton storeId={store.id} status={store.status} storeName={store.name} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
