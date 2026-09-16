import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { requirePlatformAdmin } from "@/lib/session"
import { getStoreForAdmin, listStoreLedgerForAdmin } from "@/lib/admin-queries"
import { remainingDays, TIER_SPEC } from "@/lib/subscription"
import { formatBaht, formatDate, formatDateTime } from "@/lib/format"
import { AdminStoreStatusButton } from "@/components/admin-store-status-button"
import { AdminPaymentModeForm } from "@/components/admin-payment-mode-form"
import { isScbConfigured } from "@/lib/payment-provider/scb"
import { isSlipVerificationConfigured } from "@/lib/slip-provider"
import { ConfirmSubscriptionForm, GrantCustomDaysForm, SetTableLimitForm, VoidSubscriptionButton } from "@/components/admin-billing-controls"
import { IconBack, IconShield } from "@/components/icons"

export const metadata = { title: "รายละเอียดร้าน" }

const KIND_LABEL = { RENEWAL: "ต่ออายุ", UPGRADE: "อัปเกรด", TRIAL: "ทดลองใช้", CUSTOM: "ผู้ดูแลปรับ" } as const
const STATUS_CHIP = {
  PENDING: { cls: "chip-warning", label: "รอยืนยัน" },
  PAID: { cls: "chip-success", label: "ชำระแล้ว" },
  VOID: { cls: "chip-neutral", label: "ยกเลิก" },
} as const

/// หน้าร้านรายตัวของผู้ดูแลแพลตฟอร์ม (Phase 14b) — ledger ค่าใช้งาน + ยืนยัน/ถอย/เติมวัน/ตั้งเพดาน/ระงับ
/// ยังคง "ไม่แก้ข้อมูลในร้าน" — ทุกปุ่มแตะแค่ StoreSubscription และค่าแพ็กเกจบน Store
export default async function AdminStoreDetailPage({ params }: PageProps<"/admin/stores/[id]">) {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    redirect(code === "UNAUTHENTICATED" ? "/login?callbackUrl=%2Fadmin%2Fstores" : "/access-denied?resource=PLATFORM")
  }

  const { id } = await params
  const [store, ledger] = await Promise.all([getStoreForAdmin(id), listStoreLedgerForAdmin(id)])
  if (!store) notFound()

  const now = new Date()
  const daysLeft = remainingDays(now, store.planExpiresAt)
  const planChip = !store.planExpiresAt
    ? { cls: "chip-danger", label: "ยังไม่มีแพ็กเกจ" }
    : daysLeft <= 0
      ? { cls: "chip-danger", label: "หมดอายุ" }
      : daysLeft <= 7
        ? { cls: "chip-warning", label: `เหลือ ${daysLeft} วัน` }
        : { cls: "chip-success", label: `เหลือ ${daysLeft} วัน` }
  const pendingRows = ledger.filter((r) => r.status === "PENDING")

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/stores" className="t-caption row" style={{ gap: 4 }}>
            <IconBack size={14} aria-hidden /> ร้านค้าทั้งหมด
          </Link>
          <h1 className="t-h1" style={{ marginTop: 6 }}>
            <IconShield size={22} aria-hidden /> {store.name}
          </h1>
          <p className="t-caption num" style={{ marginTop: 4 }}>
            {store.slug} · สร้างเมื่อ {formatDate(store.createdAt)} · เจ้าของ {store.ownerEmails.join(", ") || "—"} · สมาชิก {store.memberCount} คน
          </p>
        </div>
        <AdminStoreStatusButton storeId={store.id} status={store.status} storeName={store.name} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div className="stat-tile">
          <span className="t-caption">แพ็กเกจ</span>
          <span className={`chip ${planChip.cls}`} style={{ alignSelf: "flex-start", marginTop: 4 }}>
            <span className="dot" />
            {planChip.label}
          </span>
          {store.planExpiresAt ? (
            <span className="t-caption num" style={{ marginTop: 6 }}>
              {formatDateTime(store.planExpiresAt)}
            </span>
          ) : null}
        </div>
        <div className="stat-tile">
          <span className="t-caption">tier</span>
          <span className="t-h2">{store.planTier ? TIER_SPEC[store.planTier].label : "—"}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">โต๊ะ / เพดาน</span>
          <span className="t-h2 num">
            {store.tableCount} / {store.tableLimit}
          </span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">พร้อมเพย์ร้าน / ทดลอง</span>
          <span className="t-small">
            {store.promptPayIdSet ? "กรอกแล้ว" : "ยังไม่กรอก"} · {store.trialClaimed ? "ใช้สิทธิ์ทดลองแล้ว" : "ยังไม่ใช้สิทธิ์ทดลอง"}
          </span>
        </div>
      </div>

      {/* วิธีรับเงินของร้าน (Phase 15a) — SCB_BILLER ตั้งได้ที่นี่ที่เดียว */}
      <section className="card-ui card-pad">
        <h2 className="t-h2">วิธีรับเงินจากลูกค้า</h2>
        <p className="t-caption" style={{ margin: "4px 0 10px" }}>
          ปัจจุบัน: <strong>{store.paymentMode}</strong> · โหมด SCB ใช้ SCB_BILLER_ID จาก env ของแพลตฟอร์ม — เปิดให้เฉพาะร้านที่ Biller ID นั้นเป็นของร้านจริง
          (15c จะย้ายเป็น credential ต่อร้าน)
        </p>
        <AdminPaymentModeForm storeId={store.id} current={store.paymentMode} scbReady={isScbConfigured()} slipReady={isSlipVerificationConfigured()} />
      </section>

      {pendingRows.length > 0 ? (
        <section className="card-ui card-pad" style={{ borderColor: "var(--brand)" }}>
          <h2 className="t-h2">รอยืนยันเงินเข้า</h2>
          {pendingRows.map((row) => (
            <div key={row.id} className="row" style={{ justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {KIND_LABEL[row.kind]} · {row.tier} ({row.tableLimit} โต๊ะ) · {row.days} วัน
                </div>
                <div className="t-caption num">
                  {row.requestRef} · {formatBaht(row.amount)} · ขอเมื่อ {formatDateTime(row.createdAt)}
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <ConfirmSubscriptionForm id={row.id} amount={row.amount} requestRef={row.requestRef} />
                <VoidSubscriptionButton id={row.id} isPaid={false} />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h2 className="t-h2">เติมวัน (CUSTOM / ชดเชย)</h2>
          <p className="t-caption" style={{ marginTop: 2 }}>
            ต่อท้ายวันที่เหลือ ฟรี — บันทึกเป็นแถว CUSTOM ใน ledger พร้อมหมายเหตุ
          </p>
          <div style={{ marginTop: 10 }}>
            <GrantCustomDaysForm storeId={store.id} currentTier={store.planTier} />
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <h2 className="t-h2">เพดานโต๊ะพิเศษ</h2>
          <p className="t-caption" style={{ marginTop: 2 }}>
            สำหรับร้านที่เกิน XL (120 โต๊ะ) หรือดีลเฉพาะ — ตั้งต่ำกว่าจำนวนโต๊ะที่มีอยู่ไม่ได้
          </p>
          <div style={{ marginTop: 10 }}>
            <SetTableLimitForm storeId={store.id} current={store.tableLimit} />
          </div>
        </div>
      </section>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            ledger ค่าใช้งาน <span className="num">{ledger.length}</span> รายการ
          </h2>
        </div>
        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>วันที่</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>รายการ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>ช่วงเวลา</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอด</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>อ้างอิง</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--line)", opacity: row.reversed ? 0.6 : 1 }}>
                  <td className="num t-caption" style={{ padding: "12px 24px" }}>
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td style={{ padding: "12px" }}>
                    <div style={{ fontWeight: 500 }}>
                      {KIND_LABEL[row.kind]} · {row.tier} ({row.tableLimit} โต๊ะ)
                      {row.days !== 0 ? ` · ${row.days} วัน` : ""}
                    </div>
                    <div className="t-caption">
                      {row.planCode ? `${row.planCode} · ` : ""}
                      {row.note ?? ""}
                    </div>
                  </td>
                  <td className="num t-caption" style={{ padding: "12px" }}>
                    {row.days !== 0 ? `${formatDate(row.periodStart)} → ${formatDate(row.periodEnd)}` : "—"}
                  </td>
                  <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                    {formatBaht(row.amount)}
                  </td>
                  <td className="num t-caption" style={{ padding: "12px" }}>
                    {row.requestRef}
                    {row.paymentReference ? <div>ธนาคาร: {row.paymentReference}</div> : null}
                  </td>
                  <td style={{ padding: "12px" }}>
                    <span className={`chip ${STATUS_CHIP[row.status].cls}`}>
                      <span className="dot" />
                      {STATUS_CHIP[row.status].label}
                      {row.reversed ? " · ถูกถอย" : ""}
                    </span>
                  </td>
                  <td style={{ padding: "12px 24px", textAlign: "right" }}>
                    {row.status === "PAID" && !row.reversed ? <VoidSubscriptionButton id={row.id} isPaid /> : null}
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
