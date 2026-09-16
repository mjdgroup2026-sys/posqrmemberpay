"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cancelBrandBatch, requestBrandBatch } from "@/app/actions/brand"
import type { BrandBatchRow, BrandStoreRow } from "@/lib/brand-queries"
import type { PlanOption } from "@/lib/plan-queries"
import { TIER_ORDER, TIER_SPEC, remainingDays } from "@/lib/subscription"
import { formatBaht, formatDate, formatDateTime } from "@/lib/format"
import { IconBan, IconCard } from "@/components/icons"

/// ใบจ่ายรวมหลายสาขา (Phase 14c) — เลือกแพ็กเกจต่อสาขา (ต่างกันได้) → QR ยอดรวมใบเดียว → ผู้ดูแลยืนยันครั้งเดียวทั้งใบ

type Props = {
  stores: BrandStoreRow[]
  plans: PlanOption[]
  pendingBatch: BrandBatchRow | null
  batches: BrandBatchRow[]
  pendingQr: string | null
  platformPromptPay: string | null
  now: Date
}

const NONE = ""

function durationLabel(days: number) {
  if (days >= 365) return "1 ปี"
  if (days >= 30) return `${Math.round(days / 30)} เดือน`
  return `${days} วัน`
}

export function BrandBillingForm({ stores, plans, pendingBatch, batches, pendingQr, platformPromptPay, now }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  // storeId → planCode ("" = ไม่รวมสาขานี้ในใบ)
  const [choice, setChoice] = useState<Record<string, string>>({})

  const planByCode = useMemo(() => new Map(plans.map((p) => [p.code, p])), [plans])
  const selected = stores.filter((s) => choice[s.id] && choice[s.id] !== NONE)
  const total = selected.reduce((sum, s) => sum + (planByCode.get(choice[s.id])?.price ?? 0), 0)

  async function submit() {
    setPending(true)
    try {
      const fd = new FormData()
      for (const s of selected) fd.append("item", `${s.id}|${choice[s.id]}`)
      const result = await requestBrandBatch(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setChoice({})
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function cancel(batchId: string) {
    if (!confirm("ยกเลิกใบจ่ายรวมนี้ทั้งใบ? ถ้าโอนไปแล้วให้ติดต่อผู้ดูแลแทน")) return
    setPending(true)
    try {
      const fd = new FormData()
      fd.set("batchId", batchId)
      const result = await cancelBrandBatch(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {/* ───── ใบที่รอยืนยัน ───── */}
      {pendingBatch ? (
        <section className="card-ui card-pad" style={{ borderColor: "var(--brand)" }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 className="t-h2">รอผู้ดูแลยืนยันเงินเข้า</h2>
              <p className="t-body" style={{ marginTop: 4 }}>
                โอนเข้าพร้อมเพย์ของแพลตฟอร์ม{platformPromptPay ? ` ${platformPromptPay}` : ""} แล้ว<strong>ระบุเลขอ้างอิงในบันทึกโอน</strong>
                — ยืนยันแล้วแพ็กเกจของทุกสาขาในใบมีผลพร้อมกัน
              </p>
              <dl className="t-small" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginTop: 10 }}>
                <dt>เลขอ้างอิง</dt>
                <dd className="num" style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                  {pendingBatch.requestRef}
                </dd>
                <dt>ยอดรวม</dt>
                <dd className="num" style={{ fontWeight: 700 }}>
                  {formatBaht(pendingBatch.amount)}
                </dd>
                <dt>ขอเมื่อ</dt>
                <dd>{formatDateTime(pendingBatch.createdAt)}</dd>
              </dl>
              <ul className="t-small" style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                {pendingBatch.items.map((i) => (
                  <li key={i.subscriptionId}>
                    {i.storeName} — {TIER_SPEC[i.tier].label} {durationLabel(i.days)} · <span className="num">{formatBaht(i.amount)}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-danger btn-sm" style={{ marginTop: 12 }} disabled={pending} onClick={() => void cancel(pendingBatch.id)}>
                <IconBan size={14} aria-hidden />
                ยกเลิกใบนี้
              </button>
            </div>
            {pendingQr ? (
              // data URL ที่ render ฝั่ง server — ไม่ใช่ URL ภายนอก
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pendingQr} alt="QR พร้อมเพย์สำหรับชำระค่าใช้งานรวม" width={240} height={240} style={{ borderRadius: 12, border: "1px solid var(--line)" }} />
            ) : (
              <div className="alert-banner warning" style={{ maxWidth: 260 }}>
                ยังไม่ได้ตั้งพร้อมเพย์ของแพลตฟอร์ม (PLATFORM_PROMPTPAY_ID) — ติดต่อผู้ดูแลเพื่อรับช่องทางโอน
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* ───── เลือกแพ็กเกจต่อสาขา ───── */}
      {!pendingBatch ? (
        <section className="card-ui card-pad">
          <h2 className="t-h2">เลือกแพ็กเกจให้แต่ละสาขา</h2>
          <p className="t-caption" style={{ marginTop: 4 }}>
            สาขาเลือกแพ็กเกจต่างกันได้ในใบเดียวกัน · วันใหม่ต่อท้ายวันที่เหลือของแต่ละสาขา · ไม่มีส่วนลดหลายสาขาในเวอร์ชันนี้
          </p>
          <div className="datatable-wrap" style={{ marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>สาขา</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>แพ็กเกจปัจจุบัน</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>โต๊ะ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>เลือกแพ็กเกจ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ราคา</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => {
                  const daysLeft = remainingDays(now, s.planExpiresAt)
                  const blocked = s.status === "SUSPENDED" || s.pendingRequestRef !== null
                  const value = choice[s.id] ?? NONE
                  const plan = planByCode.get(value)
                  return (
                    <tr key={s.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "10px 12px" }}>
                        <strong>{s.name}</strong>
                        <div className="t-caption num">/{s.slug}</div>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {s.planTier ? (
                          <>
                            {TIER_SPEC[s.planTier].label}
                            <div className="t-caption">
                              {daysLeft > 0 ? `เหลือ ${daysLeft} วัน (ถึง ${s.planExpiresAt ? formatDate(s.planExpiresAt) : "-"})` : "หมดอายุแล้ว"}
                            </div>
                          </>
                        ) : (
                          <span className="chip chip-warning">
                            <span className="dot" />
                            ยังไม่มีแพ็กเกจ
                          </span>
                        )}
                      </td>
                      <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                        {s.tableCount}/{s.tableLimit}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {blocked ? (
                          <span className="t-caption">
                            {s.status === "SUSPENDED" ? "ถูกระงับ" : `มีคำขอค้าง ${s.pendingRequestRef}${s.pendingInBatch ? " (ในใบรวม)" : ""}`}
                          </span>
                        ) : (
                          <select className="select" value={value} onChange={(e) => setChoice((c) => ({ ...c, [s.id]: e.target.value }))} style={{ minWidth: 220 }}>
                            <option value={NONE}>— ไม่รวมในใบนี้ —</option>
                            {TIER_ORDER.map((tier) => (
                              <optgroup key={tier} label={`${TIER_SPEC[tier].label} (≤ ${TIER_SPEC[tier].tableLimit} โต๊ะ)`}>
                                {plans
                                  .filter((p) => p.tier === tier)
                                  .map((p) => (
                                    <option key={p.code} value={p.code} disabled={s.tableCount > p.tableLimit}>
                                      {durationLabel(p.durationDays)} · {formatBaht(p.price)}
                                      {s.tableCount > p.tableLimit ? " (โต๊ะเกินเพดาน)" : ""}
                                    </option>
                                  ))}
                              </optgroup>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                        {plan ? formatBaht(plan.price) : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--line)" }}>
                  <td colSpan={4} style={{ padding: "10px 12px", fontWeight: 600 }}>
                    รวม {selected.length} สาขา
                  </td>
                  <td className="num" style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700 }}>
                    {formatBaht(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={pending || selected.length === 0} onClick={() => void submit()}>
              <IconCard size={16} aria-hidden />
              สร้างใบจ่ายรวม {selected.length > 0 ? formatBaht(total) : ""}
            </button>
            <Link href="/billing" className="btn btn-ghost">
              จ่ายรายสาขาแทน
            </Link>
          </div>
        </section>
      ) : null}

      {/* ───── ประวัติใบจ่ายรวม ───── */}
      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">ประวัติใบจ่ายรวม</h2>
        </div>
        {batches.length === 0 ? (
          <p className="t-caption" style={{ padding: "0 24px 20px" }}>
            ยังไม่มีใบจ่ายรวม
          </p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>เลขอ้างอิง</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>สาขา</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอดรวม</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>เมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="num" style={{ padding: "10px 24px" }}>
                      {b.requestRef}
                      {b.paymentReference ? <div className="t-caption num">ธนาคาร {b.paymentReference}</div> : null}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span className={`chip ${b.status === "PAID" ? "chip-success" : b.status === "PENDING" ? "chip-warning" : "chip-neutral"}`}>
                        <span className="dot" />
                        {b.status === "PAID" ? "จ่ายแล้ว" : b.status === "PENDING" ? "รอยืนยัน" : "ยกเลิก"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {b.items.map((i) => (
                        <div key={i.subscriptionId} className="t-small">
                          {i.storeName} · {TIER_SPEC[i.tier].label} {durationLabel(i.days)}
                        </div>
                      ))}
                    </td>
                    <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                      {formatBaht(b.amount)}
                    </td>
                    <td style={{ padding: "10px 12px" }} className="t-small">
                      {b.paidAt ? `จ่าย ${formatDateTime(b.paidAt)}` : b.voidedAt ? `ยกเลิก ${formatDateTime(b.voidedAt)}` : `ขอ ${formatDateTime(b.createdAt)}`}
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
