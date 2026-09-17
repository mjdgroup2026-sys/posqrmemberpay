"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cancelPendingRequest, claimTrial, requestRenewal, requestUpgrade } from "@/app/actions/billing"
import type { BillingOverview, SubscriptionRow } from "@/lib/queries"
import type { PlanOption } from "@/lib/plan-queries"
import { computeUpgradeAmount, remainingDays, TIER_ORDER, TIER_SPEC, type PlanTierValue } from "@/lib/subscription"
import { formatBaht, formatDate, formatDateTime } from "@/lib/format"
import type { ActionResult, FieldErrors } from "@/lib/types"
import { IconBan, IconCard, IconCheck, IconCopy, IconTable } from "@/components/icons"

/// หน้าค่าใช้งานฝั่งร้าน (Phase 14b) — action ฝั่ง server เป็นด่านจริง (requireOwner) ฟอร์มนี้แค่ไม่ให้งง

const KIND_LABEL: Record<SubscriptionRow["kind"], string> = {
  RENEWAL: "ต่ออายุ",
  UPGRADE: "อัปเกรด",
  TRIAL: "ทดลองใช้",
  CUSTOM: "ผู้ดูแลปรับ",
}
const STATUS_CHIP: Record<SubscriptionRow["status"], { cls: string; label: string }> = {
  PENDING: { cls: "chip-warning", label: "รอยืนยัน" },
  PAID: { cls: "chip-success", label: "ชำระแล้ว" },
  VOID: { cls: "chip-neutral", label: "ยกเลิก" },
}

export function BillingPanel({
  overview,
  history,
  plans,
  pendingQr,
  platformPromptPay,
  now,
  trialUsedAt = [],
}: {
  overview: BillingOverview
  history: SubscriptionRow[]
  plans: PlanOption[]
  pendingQr: string | null
  platformPromptPay: string | null
  now: Date
  /// ร้านอื่นของเจ้าของคนนี้ที่รับสิทธิ์ทดลองไปแล้ว — ใช้เลขพร้อมเพย์เดิมรับซ้ำไม่ได้
  trialUsedAt?: string[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [tier, setTier] = useState<PlanTierValue>(overview.tier ?? "S")

  const daysLeft = remainingDays(now, overview.planExpiresAt)
  const active = daysLeft > 0
  const tierPlans = useMemo(() => plans.filter((p) => p.tier === tier).sort((a, b) => a.durationDays - b.durationDays), [plans, tier])
  const upgradeTargets = overview.tier ? TIER_ORDER.filter((t) => TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(overview.tier as PlanTierValue)) : []

  async function run<T>(action: (formData: FormData) => Promise<ActionResult<T>>, fields: Record<string, string>) {
    setPending(true)
    setFieldErrors({})
    const formData = new FormData()
    for (const [k, v] of Object.entries(fields)) formData.set(k, v)
    try {
      const result = await action(formData)
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("คัดลอกแล้ว")
    } catch {
      toast.error("คัดลอกไม่สำเร็จ")
    }
  }

  const statusChip = !overview.planExpiresAt
    ? { cls: "chip-danger", label: "ยังไม่เปิดใช้งาน" }
    : !active
      ? { cls: "chip-danger", label: "หมดอายุแล้ว" }
      : daysLeft <= 7
        ? { cls: "chip-warning", label: `เหลือ ${daysLeft} วัน` }
        : { cls: "chip-success", label: `เหลือ ${daysLeft} วัน` }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ───── สถานะปัจจุบัน ───── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div className="stat-tile">
          <span className="t-caption">สถานะแพ็กเกจ</span>
          <span className={`chip ${statusChip.cls}`} style={{ alignSelf: "flex-start", marginTop: 4 }}>
            <span className="dot" />
            {statusChip.label}
          </span>
          {overview.planExpiresAt ? (
            <span className="t-caption num" style={{ marginTop: 6 }}>
              {active ? "หมดอายุ" : "หมดอายุเมื่อ"} {formatDateTime(overview.planExpiresAt)}
            </span>
          ) : null}
        </div>
        <div className="stat-tile">
          <span className="t-caption">ระดับ (tier)</span>
          <span className="t-h2">{overview.tier ? TIER_SPEC[overview.tier].label : "—"}</span>
        </div>
        <div className="stat-tile">
          <span className="t-caption">โต๊ะที่ใช้อยู่ / เพดาน</span>
          <span className="t-h2 num">
            {overview.tableCount} / {overview.tableLimit}
          </span>
          {overview.tableCount >= overview.tableLimit ? <span className="t-caption">เต็มเพดาน — อัปเกรดเพื่อเพิ่มโต๊ะ</span> : null}
        </div>
      </div>

      {!active ? (
        <div className="alert-banner danger">
          {overview.planExpiresAt
            ? "แพ็กเกจหมดอายุแล้ว — ดูข้อมูลเดิมได้ แต่เปิดโต๊ะ/ขาย/รับออเดอร์ใหม่ไม่ได้จนกว่าจะต่ออายุ"
            : trialUsedAt.length > 0
              ? `ร้านยังไม่เปิดใช้งาน — คุณใช้สิทธิ์ทดลองฟรีไปแล้วที่ร้าน ${trialUsedAt.join(", ")} ร้านนี้จึงรับซ้ำด้วยเลขพร้อมเพย์เดิมไม่ได้ เลือกแพ็กเกจด้านล่างเพื่อเปิดใช้งาน`
              : "ร้านยังไม่เปิดใช้งาน — รับสิทธิ์ทดลองฟรี 7 วันด้านล่าง หรือเลือกแพ็กเกจ แล้วจึงเปิดโต๊ะ/ขายได้"}
        </div>
      ) : null}

      {/* ───── ทดลองใช้ ───── */}
      {overview.trialAvailable ? (
        <section className="card-ui card-pad">
          <h2 className="t-h2">ทดลองใช้ฟรี 7 วัน</h2>
          <p className="t-body" style={{ marginTop: 6 }}>
            กรอกเลขพร้อมเพย์ของร้าน (ที่จะใช้รับเงินจากลูกค้า) เพื่อเปิดใช้งานทันที — 1 เลขพร้อมเพย์รับสิทธิ์ทดลองได้ครั้งเดียว
          </p>
          {trialUsedAt.length > 0 ? (
            <div className="alert-banner warning" style={{ marginTop: 10 }}>
              เลขพร้อมเพย์ที่ใช้รับทดลองที่ร้าน {trialUsedAt.join(", ")} ไปแล้ว ใช้ซ้ำที่นี่ไม่ได้ — ต้องเป็นเลขอื่นที่ยังไม่เคยใช้ ไม่งั้นให้เลือกแพ็กเกจแทน
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              void run(claimTrial, { promptPayId: String(fd.get("promptPayId") ?? "") })
            }}
            className="row"
            style={{ gap: 10, alignItems: "flex-start", marginTop: 12, flexWrap: "wrap" }}
          >
            <div className="field" style={{ flex: "1 1 260px" }}>
              <label className="t-small" htmlFor="promptPayId">
                เลขพร้อมเพย์ (เบอร์โทร / บัตรประชาชน / e-Wallet)
              </label>
              <input id="promptPayId" name="promptPayId" className="input num" required placeholder="0812345678" inputMode="numeric" />
              {fieldErrors.promptPayId ? <span className="field-hint error">{fieldErrors.promptPayId}</span> : null}
            </div>
            <div style={{ paddingTop: 22 }}>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                <IconCheck size={16} aria-hidden />
                เปิดใช้งานฟรี 7 วัน
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* ───── คำขอที่รอยืนยัน ───── */}
      {overview.pending ? (
        <section className="card-ui card-pad" style={{ borderColor: "var(--brand)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <span className="chip chip-warning">
                <span className="dot" />
                รอผู้ดูแลยืนยัน
              </span>
              <h2 className="t-h2" style={{ marginTop: 8 }}>
                {KIND_LABEL[overview.pending.kind]} {TIER_SPEC[overview.pending.tier].label}
                {overview.pending.kind === "RENEWAL" ? ` · ${overview.pending.days} วัน` : ` · ${overview.pending.days} วันที่เหลือ`}
              </h2>
              <p className="t-h1 num" style={{ marginTop: 6 }}>
                {formatBaht(overview.pending.amount)}
              </p>
              <p className="t-body" style={{ marginTop: 8 }}>
                โอนเข้าพร้อมเพย์ของแพลตฟอร์ม{platformPromptPay ? ` ${platformPromptPay}` : ""} แล้ว<strong>ระบุเลขอ้างอิงในบันทึกโอน</strong>
              </p>
              <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
                <code className="t-h2 num">{overview.pending.requestRef}</code>
                <button type="button" className="btn btn-subtle btn-sm" onClick={() => void copy(overview.pending?.requestRef ?? "")}>
                  <IconCopy size={14} aria-hidden />
                  คัดลอก
                </button>
              </div>
              <p className="t-caption" style={{ marginTop: 8 }}>
                ขอเมื่อ {formatDateTime(overview.pending.createdAt)} · ผู้ดูแลตรวจเงินเข้าแล้วจะยืนยันให้ แพ็กเกจมีผลทันทีที่ยืนยัน
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 10 }}
                disabled={pending}
                onClick={() => void run(cancelPendingRequest, { id: overview.pending?.id ?? "" })}
              >
                <IconBan size={14} aria-hidden />
                ยกเลิกคำขอนี้
              </button>
            </div>
            {pendingQr ? (
              // data URL ที่ render ฝั่ง server — ไม่ใช่ URL ภายนอก
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pendingQr} alt="QR พร้อมเพย์สำหรับชำระค่าใช้งาน" width={240} height={240} style={{ borderRadius: 12, border: "1px solid var(--line)" }} />
            ) : (
              <div className="alert-banner warning" style={{ maxWidth: 260 }}>
                ยังไม่ได้ตั้งพร้อมเพย์ของแพลตฟอร์ม (PLATFORM_PROMPTPAY_ID) — ติดต่อผู้ดูแลเพื่อรับช่องทางโอน
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* ───── เลือกแพ็กเกจ ───── */}
      {!overview.pending ? (
        <section className="card-ui card-pad">
          <h2 className="t-h2">{active ? "ต่ออายุล่วงหน้า" : "เลือกแพ็กเกจ"}</h2>
          <p className="t-caption" style={{ marginTop: 4 }}>
            {active ? "วันใหม่ต่อท้ายวันที่เหลือ — ไม่เสียวันเดิม" : "เปิดใช้งานร้านทันทีที่ผู้ดูแลยืนยันเงินเข้า"}
            {" · "}ราคาสุทธิเป็นบาทเต็ม
          </p>

          <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {TIER_ORDER.map((t) => {
              const tooSmall = overview.tableCount > TIER_SPEC[t].tableLimit
              return (
                <button
                  key={t}
                  type="button"
                  className={`btn btn-sm ${tier === t ? "btn-primary" : "btn-subtle"}`}
                  onClick={() => setTier(t)}
                  disabled={tooSmall}
                  title={tooSmall ? `ร้านมี ${overview.tableCount} โต๊ะ เกินเพดาน ${TIER_SPEC[t].tableLimit}` : undefined}
                >
                  <IconTable size={14} aria-hidden />
                  {TIER_SPEC[t].label}
                </button>
              )
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
            {tierPlans.map((plan) => (
              <div key={plan.id} className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="t-small" style={{ fontWeight: 600 }}>
                  {plan.durationDays >= 30 ? (plan.durationDays >= 365 ? "1 ปี" : `${Math.round(plan.durationDays / 30)} เดือน`) : `${plan.durationDays} วัน`}
                </span>
                <span className="t-h2 num">{formatBaht(plan.price)}</span>
                <span className="t-caption num">
                  เฉลี่ย {formatBaht(plan.price / plan.durationDays)}/วัน
                  {plan.discountPercent > 0 ? ` · ลด ${plan.discountPercent}%` : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm btn-block"
                  disabled={pending}
                  onClick={() => void run(requestRenewal, { planCode: plan.code })}
                >
                  <IconCard size={14} aria-hidden />
                  เลือก
                </button>
              </div>
            ))}
            {tierPlans.length === 0 ? <p className="t-caption">ยังไม่มีแพ็กเกจในระดับนี้</p> : null}
          </div>

          {active && upgradeTargets.length > 0 && overview.tier ? (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <h3 className="t-h3">อัปเกรดตอนนี้ (จ่ายส่วนต่างสำหรับ {daysLeft} วันที่เหลือ)</h3>
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {upgradeTargets.map((t) => {
                  const amount = computeUpgradeAmount(TIER_SPEC[overview.tier as PlanTierValue].ratePerDay, TIER_SPEC[t].ratePerDay, daysLeft)
                  return (
                    <button key={t} type="button" className="btn btn-subtle" disabled={pending} onClick={() => void run(requestUpgrade, { tier: t })}>
                      → {TIER_SPEC[t].label} · <span className="num">{formatBaht(amount)}</span>
                    </button>
                  )
                })}
              </div>
              <p className="t-caption" style={{ marginTop: 6 }}>
                เพดานโต๊ะเพิ่มทันทีที่ยืนยัน วันหมดอายุคงเดิม · ลดระดับทำได้ตอนต่ออายุรอบถัดไป (ถ้าโต๊ะไม่เกินเพดานใหม่)
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ───── ประวัติ ───── */}
      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">ประวัติค่าใช้งาน</h2>
        </div>
        {history.length === 0 ? (
          <p className="t-caption card-pad">ยังไม่มีรายการ</p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>วันที่</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>รายการ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>ช่วงเวลา</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอด</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>อ้างอิง</th>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} style={{ borderTop: "1px solid var(--line)", opacity: row.reversed ? 0.6 : 1 }}>
                    <td className="num t-caption" style={{ padding: "12px 24px" }}>{formatDateTime(row.createdAt)}</td>
                    <td style={{ padding: "12px" }}>
                      <div style={{ fontWeight: 500 }}>
                        {KIND_LABEL[row.kind]} · {row.tier} ({row.tableLimit} โต๊ะ)
                        {row.days !== 0 ? ` · ${row.days} วัน` : ""}
                      </div>
                      {row.note ? <div className="t-caption">{row.note}</div> : null}
                    </td>
                    <td className="num t-caption" style={{ padding: "12px" }}>
                      {row.days !== 0 ? `${formatDate(row.periodStart)} → ${formatDate(row.periodEnd)}` : "—"}
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>{formatBaht(row.amount)}</td>
                    <td className="num t-caption" style={{ padding: "12px" }}>
                      {row.requestRef}
                      {row.paymentReference ? <div>ธนาคาร: {row.paymentReference}</div> : null}
                    </td>
                    <td style={{ padding: "12px 24px" }}>
                      <span className={`chip ${STATUS_CHIP[row.status].cls}`}>
                        <span className="dot" />
                        {STATUS_CHIP[row.status].label}
                        {row.reversed ? " · ถูกถอย" : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
