import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { requirePlatformAdmin } from "@/lib/session"
import { getBatchForAdmin } from "@/lib/admin-queries"
import { TIER_SPEC } from "@/lib/subscription"
import { formatBaht, formatDate, formatDateTime } from "@/lib/format"
import { ConfirmBatchForm, VoidBatchForm } from "@/components/admin-batch-controls"
import { IconBack, IconShield } from "@/components/icons"

export const metadata = { title: "ใบจ่ายรวม" }

const STATUS_CHIP = {
  PENDING: { cls: "chip-warning", label: "รอยืนยัน" },
  PAID: { cls: "chip-success", label: "ชำระแล้ว" },
  VOID: { cls: "chip-neutral", label: "ยกเลิก" },
} as const

/// ใบจ่ายรวมของแบรนด์ในมุมผู้ดูแลแพลตฟอร์ม (Phase 14c) — ยืนยัน/ยกเลิกทั้งใบ · ใบที่จ่ายแล้วถอยรายสาขาที่หน้าร้านนั้น
export default async function AdminBatchPage({ params }: PageProps<"/admin/batches/[id]">) {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    redirect(code === "UNAUTHENTICATED" ? "/login?callbackUrl=%2Fadmin%2Fstores" : "/access-denied?resource=PLATFORM")
  }

  const { id } = await params
  const batch = await getBatchForAdmin(id)
  if (!batch) notFound()
  const chip = STATUS_CHIP[batch.status]
  const overCap = batch.items.filter((i) => i.tableCount > i.tableLimit)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href="/admin/stores" className="row" style={{ gap: 4, display: "inline-flex" }}>
              <IconBack size={14} aria-hidden /> ร้านค้าทั้งหมด
            </Link>
          </p>
          <h1 className="t-h1">
            <IconShield size={22} aria-hidden /> ใบจ่ายรวม <span className="num">{batch.requestRef}</span>
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            แบรนด์ <strong>{batch.brand.name}</strong> · เจ้าของ {batch.brand.ownerName} ({batch.brand.ownerEmail}) · ขอเมื่อ{" "}
            {formatDateTime(batch.createdAt)}
          </p>
        </div>
        <span className={`chip ${chip.cls}`}>
          <span className="dot" />
          {chip.label}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div className="stat-tile">
          <span className="t-caption">ยอดรวมที่ต้องโอน</span>
          <span className="t-h2 num">{formatBaht(batch.amount)}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">จำนวนสาขา</span>
          <span className="t-h2 num">{batch.items.length}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">เลขอ้างอิงธนาคาร</span>
          <span className="t-h2 num">{batch.paymentReference ?? "—"}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">{batch.paidAt ? "ยืนยันเมื่อ" : batch.voidedAt ? "ยกเลิกเมื่อ" : "สถานะ"}</span>
          <span className="t-h3">{batch.paidAt ? formatDateTime(batch.paidAt) : batch.voidedAt ? formatDateTime(batch.voidedAt) : "รอเงินเข้า"}</span>
        </div>
      </div>

      {batch.status === "PENDING" ? (
        <section className="card-ui card-pad" style={{ borderColor: "var(--brand)" }}>
          <h2 className="t-h2">ยืนยันเงินเข้า</h2>
          <p className="t-caption" style={{ margin: "4px 0 10px" }}>
            ทั้งใบหรือไม่เลย — ถ้ามีสาขาใดยืนยันไม่ได้ (เช่น โต๊ะเกินเพดาน) ทั้งใบจะไม่เปลี่ยนแปลง
          </p>
          {overCap.length > 0 ? (
            <div className="alert-banner warning" style={{ marginBottom: 10 }}>
              ยืนยันไม่ได้ตอนนี้: {overCap.map((i) => `${i.storeName} มี ${i.tableCount} โต๊ะ เกินเพดาน ${i.tableLimit}`).join(" · ")} — ให้ร้านลบโต๊ะก่อน
              หรือยกเลิกใบให้ขอใหม่
            </div>
          ) : null}
          <ConfirmBatchForm batchId={batch.id} amount={batch.amount} requestRef={batch.requestRef} storeCount={batch.items.length} />
          <div style={{ marginTop: 12 }}>
            <VoidBatchForm batchId={batch.id} />
          </div>
        </section>
      ) : null}

      {batch.note ? <div className="alert-banner info">{batch.note}</div> : null}

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">รายการสาขาในใบ</h2>
        </div>
        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>สาขา</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>แพ็กเกจ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>โต๊ะ/เพดาน</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>ช่วงเวลา</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอด</th>
              </tr>
            </thead>
            <tbody>
              {batch.items.map((i) => {
                const rowChip = STATUS_CHIP[i.status]
                return (
                  <tr key={i.subscriptionId} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 24px" }}>
                      <Link href={`/admin/stores/${i.storeId}`} style={{ fontWeight: 600 }}>
                        {i.storeName}
                      </Link>
                      <div className="t-caption num">
                        /{i.storeSlug} · {i.requestRef}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {TIER_SPEC[i.tier].label} · {i.days} วัน
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right", color: i.tableCount > i.tableLimit ? "var(--danger)" : undefined }}>
                      {i.tableCount}/{i.tableLimit}
                    </td>
                    <td style={{ padding: "10px 12px" }} className="t-small">
                      {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
                      {i.status === "PENDING" ? <div className="t-caption">คำนวณจริงตอนยืนยัน</div> : null}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span className={`chip ${rowChip.cls}`}>
                        <span className="dot" />
                        {rowChip.label}
                      </span>
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                      {formatBaht(i.amount)}
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
