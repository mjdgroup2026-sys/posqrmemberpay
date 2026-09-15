"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { confirmSubscription, grantCustomDays, setTableLimit, voidSubscription } from "@/app/actions/admin-billing"
import type { ActionResult, FieldErrors } from "@/lib/types"
import { IconBan, IconCheck, IconPlus, IconTable } from "@/components/icons"

/// ปุ่ม/ฟอร์มของผู้ดูแลแพลตฟอร์มบนหน้า /admin/stores/[id] (Phase 14b) — ด่านจริงคือ requirePlatformAdmin() ใน action

function useRun() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  async function run<T>(action: (formData: FormData) => Promise<ActionResult<T>>, formData: FormData, onDone?: () => void) {
    setPending(true)
    setFieldErrors({})
    try {
      const result = await action(formData)
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return false
      }
      toast.success(result.message)
      onDone?.()
      router.refresh()
      return true
    } catch {
      toast.error("ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return false
    } finally {
      setPending(false)
    }
  }
  return { run, pending, fieldErrors }
}

/// ยืนยันคำขอ PENDING — กรอกเลขอ้างอิงจากแอปธนาคาร
export function ConfirmSubscriptionForm({ id, amount, requestRef }: { id: string; amount: number; requestRef: string }) {
  const { run, pending, fieldErrors } = useRun()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <IconCheck size={14} aria-hidden />
        ยืนยันเงินเข้า
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        fd.set("id", id)
        void run(confirmSubscription, fd, () => setOpen(false))
      }}
      className="row"
      style={{ gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}
    >
      <div className="field" style={{ flex: "1 1 180px" }}>
        <input name="paymentReference" className="input num" required placeholder="เลขอ้างอิงธนาคาร" autoComplete="off" autoFocus />
        <span className="field-hint">
          ตรวจในแอปธนาคารว่ามีเงินเข้า {amount.toLocaleString("th-TH")} บาท ระบุ {requestRef}
        </span>
        {fieldErrors.paymentReference ? <span className="field-hint error">{fieldErrors.paymentReference}</span> : null}
      </div>
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
        ยืนยัน
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setOpen(false)}>
        ปิด
      </button>
    </form>
  )
}

export function VoidSubscriptionButton({ id, isPaid }: { id: string; isPaid: boolean }) {
  const { run, pending } = useRun()
  return (
    <button
      type="button"
      className="btn btn-danger btn-sm"
      disabled={pending}
      onClick={() => {
        const reason = window.prompt(isPaid ? "เหตุผลที่ถอยรายการนี้ (จะถอยวัน/เพดานของร้านกลับ):" : "เหตุผลที่ยกเลิกคำขอนี้:")
        if (!reason) return
        const fd = new FormData()
        fd.set("id", id)
        fd.set("reason", reason)
        void run(voidSubscription, fd)
      }}
    >
      <IconBan size={14} aria-hidden />
      {isPaid ? "ถอยรายการ" : "ยกเลิก"}
    </button>
  )
}

export function GrantCustomDaysForm({ storeId, currentTier }: { storeId: string; currentTier: "S" | "M" | "L" | "XL" | null }) {
  const { run, pending, fieldErrors } = useRun()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const fd = new FormData(form)
        fd.set("storeId", storeId)
        void run(grantCustomDays, fd, () => form.reset())
      }}
      className="row"
      style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
    >
      <div className="field" style={{ flex: "0 0 110px" }}>
        <label className="t-small" htmlFor="grant-days">
          จำนวนวัน
        </label>
        <input id="grant-days" name="days" type="number" className="input num" min={1} max={3650} required defaultValue={7} />
        {fieldErrors.days ? <span className="field-hint error">{fieldErrors.days}</span> : null}
      </div>
      <div className="field" style={{ flex: "0 0 140px" }}>
        <label className="t-small" htmlFor="grant-tier">
          tier
        </label>
        <select id="grant-tier" name="tier" className="select" defaultValue={currentTier ?? ""}>
          <option value="">ตามปัจจุบัน{currentTier ? ` (${currentTier})` : " (S)"}</option>
          <option value="S">S</option>
          <option value="M">M</option>
          <option value="L">L</option>
          <option value="XL">XL</option>
        </select>
      </div>
      <div className="field" style={{ flex: "1 1 220px" }}>
        <label className="t-small" htmlFor="grant-note">
          หมายเหตุ (บันทึกลง ledger)
        </label>
        <input id="grant-note" name="note" className="input" required placeholder="เช่น ชดเชยระบบล่ม 15 ก.ย." />
        {fieldErrors.note ? <span className="field-hint error">{fieldErrors.note}</span> : null}
      </div>
      <div style={{ paddingTop: 22 }}>
        <button type="submit" className="btn btn-subtle" disabled={pending}>
          <IconPlus size={14} aria-hidden />
          เติมวัน
        </button>
      </div>
    </form>
  )
}

export function SetTableLimitForm({ storeId, current }: { storeId: string; current: number }) {
  const { run, pending, fieldErrors } = useRun()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const fd = new FormData(form)
        fd.set("storeId", storeId)
        void run(setTableLimit, fd, () => form.reset())
      }}
      className="row"
      style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
    >
      <div className="field" style={{ flex: "0 0 130px" }}>
        <label className="t-small" htmlFor="limit-n">
          เพดานโต๊ะใหม่
        </label>
        <input id="limit-n" name="tableLimit" type="number" className="input num" min={1} max={1000} required defaultValue={current} />
        {fieldErrors.tableLimit ? <span className="field-hint error">{fieldErrors.tableLimit}</span> : null}
      </div>
      <div className="field" style={{ flex: "1 1 220px" }}>
        <label className="t-small" htmlFor="limit-note">
          หมายเหตุ
        </label>
        <input id="limit-note" name="note" className="input" required placeholder="เช่น ดีลพิเศษ 150 โต๊ะ" />
        {fieldErrors.note ? <span className="field-hint error">{fieldErrors.note}</span> : null}
      </div>
      <div style={{ paddingTop: 22 }}>
        <button type="submit" className="btn btn-subtle" disabled={pending}>
          <IconTable size={14} aria-hidden />
          ตั้งเพดาน
        </button>
      </div>
    </form>
  )
}
