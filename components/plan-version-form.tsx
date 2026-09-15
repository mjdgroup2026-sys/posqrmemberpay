"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { publishPlanVersion, retirePlan } from "@/app/actions/admin-billing"
import type { PlanVersionRow } from "@/lib/admin-queries"
import { TIER_SPEC } from "@/lib/subscription"
import type { FieldErrors } from "@/lib/types"
import { IconBan, IconPlus } from "@/components/icons"

/// ออก version ใหม่ของแพ็กเกจ (Phase 14b) — append-only: แถวเก่าไม่ถูกแก้ แค่ isActive=false + supersededById
export function PlanVersionForm({ preset }: { preset?: PlanVersionRow }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [tier, setTier] = useState<"S" | "M" | "L" | "XL">(preset?.tier ?? "S")

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setPending(true)
    setFieldErrors({})
    try {
      const result = await publishPlanVersion(new FormData(form))
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      form.reset()
      router.refresh()
    } catch {
      toast.error("ออกแพ็กเกจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, alignItems: "start" }}>
      <div className="field">
        <label className="t-small" htmlFor="plan-code">
          รหัส (code)
        </label>
        <input id="plan-code" name="code" className="input num" required defaultValue={preset?.code ?? ""} placeholder="S-D7" style={{ textTransform: "uppercase" }} />
        <span className="field-hint">code เดิม = version ใหม่แทนที่</span>
        {fieldErrors.code ? <span className="field-hint error">{fieldErrors.code}</span> : null}
      </div>
      <div className="field" style={{ gridColumn: "span 2" }}>
        <label className="t-small" htmlFor="plan-name">
          ชื่อ
        </label>
        <input id="plan-name" name="name" className="input" required defaultValue={preset?.name ?? ""} placeholder="S · 7 วัน" />
        {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
      </div>
      <div className="field">
        <label className="t-small" htmlFor="plan-tier">
          tier
        </label>
        <select id="plan-tier" name="tier" className="select" value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
          {(["S", "M", "L", "XL"] as const).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="t-small" htmlFor="plan-limit">
          เพดานโต๊ะ
        </label>
        <input id="plan-limit" name="tableLimit" type="number" className="input num" required min={1} key={tier} defaultValue={preset?.tableLimit ?? TIER_SPEC[tier].tableLimit} />
        {fieldErrors.tableLimit ? <span className="field-hint error">{fieldErrors.tableLimit}</span> : null}
      </div>
      <div className="field">
        <label className="t-small" htmlFor="plan-days">
          จำนวนวัน
        </label>
        <input id="plan-days" name="durationDays" type="number" className="input num" required min={1} defaultValue={preset?.durationDays ?? 30} />
        {fieldErrors.durationDays ? <span className="field-hint error">{fieldErrors.durationDays}</span> : null}
      </div>
      <div className="field">
        <label className="t-small" htmlFor="plan-rate">
          เรต/วัน (บาท)
        </label>
        <input id="plan-rate" name="ratePerDay" type="number" step="0.01" className="input num" required min={0} key={`rate-${tier}`} defaultValue={preset?.ratePerDay ?? TIER_SPEC[tier].ratePerDay} />
        {fieldErrors.ratePerDay ? <span className="field-hint error">{fieldErrors.ratePerDay}</span> : null}
      </div>
      <div className="field">
        <label className="t-small" htmlFor="plan-price">
          ราคาสุทธิ (บาท)
        </label>
        <input id="plan-price" name="price" type="number" step="1" className="input num" required min={0} defaultValue={preset?.price ?? ""} />
        <span className="field-hint">ตั้งตรง ๆ เป็นบาทเต็ม — ส่วนลดคำนวณให้</span>
        {fieldErrors.price ? <span className="field-hint error">{fieldErrors.price}</span> : null}
      </div>
      <div className="field">
        <label className="t-small" htmlFor="plan-sort">
          ลำดับ
        </label>
        <input id="plan-sort" name="sortOrder" type="number" className="input num" min={0} defaultValue={preset?.sortOrder ?? 0} />
      </div>
      <div style={{ paddingTop: 22 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <IconPlus size={16} aria-hidden />
          ออก version ใหม่
        </button>
      </div>
    </form>
  )
}

export function RetirePlanButton({ code }: { code: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-danger btn-sm"
      disabled={pending}
      onClick={async () => {
        if (!window.confirm(`เลิกขาย ${code}? ร้านจะไม่เห็นแพ็กเกจนี้ในหน้าค่าใช้งานอีก (รายการที่ซื้อไปแล้วไม่กระทบ)`)) return
        setPending(true)
        const fd = new FormData()
        fd.set("code", code)
        try {
          const result = await retirePlan(fd)
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          toast.success(result.message)
          router.refresh()
        } catch {
          toast.error("ทำรายการไม่สำเร็จ")
        } finally {
          setPending(false)
        }
      }}
    >
      <IconBan size={14} aria-hidden />
      เลิกขาย
    </button>
  )
}
