"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { confirmSubscriptionBatch, voidSubscriptionBatch } from "@/app/actions/admin-billing"
import type { ActionResult, FieldErrors } from "@/lib/types"
import { IconBan, IconCheck } from "@/components/icons"

/// ปุ่มของผู้ดูแลแพลตฟอร์มบนหน้า /admin/batches/[id] (Phase 14c) — ยืนยัน/ยกเลิก "ทั้งใบ" เท่านั้น

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

export function ConfirmBatchForm({ batchId, amount, requestRef, storeCount }: { batchId: string; amount: number; requestRef: string; storeCount: number }) {
  const { run, pending, fieldErrors } = useRun()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        fd.set("batchId", batchId)
        void run(confirmSubscriptionBatch, fd)
      }}
      className="row"
      style={{ gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}
    >
      <div className="field" style={{ flex: "1 1 220px" }}>
        <input name="paymentReference" className="input num" required placeholder="เลขอ้างอิงธนาคาร" autoComplete="off" />
        <span className="field-hint">
          ตรวจในแอปธนาคารว่ามีเงินเข้า {amount.toLocaleString("th-TH")} บาท ระบุ {requestRef} — ยืนยันแล้วมีผลทั้ง {storeCount} สาขาพร้อมกัน
        </span>
        {fieldErrors.paymentReference ? <span className="field-hint error">{fieldErrors.paymentReference}</span> : null}
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        <IconCheck size={16} aria-hidden />
        ยืนยันทั้งใบ
      </button>
    </form>
  )
}

export function VoidBatchForm({ batchId }: { batchId: string }) {
  const { run, pending, fieldErrors } = useRun()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setOpen(true)}>
        <IconBan size={14} aria-hidden />
        ยกเลิกทั้งใบ
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        fd.set("batchId", batchId)
        void run(voidSubscriptionBatch, fd, () => setOpen(false))
      }}
      className="row"
      style={{ gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}
    >
      <div className="field" style={{ flex: "1 1 220px" }}>
        <input name="reason" className="input" required minLength={3} maxLength={200} placeholder="เหตุผลที่ยกเลิก" autoFocus />
        {fieldErrors.reason ? <span className="field-hint error">{fieldErrors.reason}</span> : null}
      </div>
      <button type="submit" className="btn btn-danger-solid btn-sm" disabled={pending}>
        ยืนยันยกเลิก
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setOpen(false)}>
        ปิด
      </button>
    </form>
  )
}
