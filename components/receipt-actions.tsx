"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  cancelReceiptRemaining,
  closeStockReceipt,
  restoreReceiptRemaining,
  voidStockReceiptRound,
} from "@/app/actions/stock-docs"
import { formatNumber } from "@/lib/format"
import type { ActionResult, FieldErrors } from "@/lib/types"
import { IconBan, IconCancelRemaining, IconSpinner, IconTruck, IconUndo } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/// ปุ่มของใบรับแบบร่าง + รับหลายรอบ (Phase 21d) — ใช้บนหน้า `/stock/receipts/[id]`
/// · รับสินค้าเพิ่ม/แก้ใบ ไปที่ฟอร์มตารางเดียว (`receipt-form.tsx`) ไม่มีหน้าต่างเด้งแยก
/// · การมองเห็นปุ่มมาจากสิทธิ์ที่หน้าคำนวณให้ (`STOCK_IN` ADD/DELETE) · ด่านจริงอยู่ใน action ทุกตัว

/// ส่ง action → toast → refresh · คืน true เมื่อสำเร็จ (ให้ผู้เรียกปิด dialog)
function useSubmit() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  async function submit(action: (formData: FormData) => Promise<ActionResult>, formData: FormData): Promise<boolean> {
    setPending(true)
    setErrors({})
    try {
      const result = await action(formData)
      if (!result.ok) {
        toast.error(result.error)
        setErrors(result.fieldErrors ?? {})
        return false
      }
      toast.success(result.message)
      router.refresh()
      return true
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return false
    } finally {
      setPending(false)
    }
  }

  return { pending, errors, submit }
}

export function ReceiptToolbar({
  documentId,
  docNumber,
  receiveHref,
  canAdd,
}: {
  documentId: string
  docNumber: string
  /// หน้าฟอร์มตารางเดียว (รับสินค้าเพิ่ม + แก้ใบ)
  receiveHref: string
  /// ใบยังค้างรับ + มีสิทธิ์ STOCK_IN:ADD
  canAdd: boolean
}) {
  const [closeOpen, setCloseOpen] = useState(false)
  if (!canAdd) return null

  return (
    <>
      <button type="button" className="btn btn-subtle" onClick={() => setCloseOpen(true)}>
        <IconCancelRemaining size={17} aria-hidden />
        ปิดใบ
      </button>
      <Link href={receiveHref} className="btn btn-primary">
        <IconTruck size={17} aria-hidden />
        รับสินค้า / แก้ไข
      </Link>
      <CloseDialog open={closeOpen} onOpenChange={setCloseOpen} documentId={documentId} docNumber={docNumber} />
    </>
  )
}

/// dialog กรอกเหตุผลอย่างเดียว — ใช้ทั้งปิดใบและยกเลิกรอบรับ
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  placeholder: string
  confirmLabel: string
  danger?: boolean
  onConfirm: (reason: string) => Promise<boolean>
}) {
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    const ok = await onConfirm(reason)
    setPending(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label className="t-small" htmlFor="reason-input">
              เหตุผล <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input id="reason-input" className="input" required autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
          </div>
          <DialogFooter>
            <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)}>
              ไม่ทำรายการ
            </button>
            <button type="submit" className={danger ? "btn btn-danger-solid" : "btn btn-primary"} disabled={pending}>
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
              {confirmLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CloseDialog({
  open,
  onOpenChange,
  documentId,
  docNumber,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId: string
  docNumber: string
}) {
  const { submit } = useSubmit()
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`ปิดใบ ${docNumber}`}
      description="ยกเลิกยอดค้างรับของทุกรายการ (ของที่รับแล้วไม่เปลี่ยน สต็อกไม่เปลี่ยน) — ถ้าผู้ขายกลับมาส่งทีหลัง กด &quot;คืนยอดค้าง&quot; ที่รายการนั้นได้"
      placeholder="เช่น ผู้ขายไม่มีของ / ยกเลิกการสั่ง"
      confirmLabel="ยืนยันปิดใบ"
      onConfirm={(reason) => {
        const formData = new FormData()
        formData.set("id", documentId)
        formData.set("reason", reason)
        return submit(closeStockReceipt, formData)
      }}
    />
  )
}

/// ปุ่มต่อบรรทัด: ยกเลิกยอดค้าง (บางส่วน/ทั้งหมด) · คืนยอดที่ยกเลิกไว้
export function ReceiptLineButtons({
  lineId,
  name,
  unit,
  remaining,
  cancelledQty,
  canCancel,
  canRestore,
}: {
  lineId: string
  name: string
  unit: string
  remaining: number
  cancelledQty: number
  canCancel: boolean
  canRestore: boolean
}) {
  const { pending, errors, submit } = useSubmit()
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(String(remaining))
  const [reason, setReason] = useState("")

  const showCancel = canCancel && remaining > 0
  const showRestore = canRestore && cancelledQty > 0
  if (!showCancel && !showRestore) return null

  async function handleCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set("lineId", lineId)
    formData.set("quantity", quantity)
    formData.set("reason", reason)
    if (await submit(cancelReceiptRemaining, formData)) setOpen(false)
  }

  async function handleRestore() {
    const formData = new FormData()
    formData.set("lineId", lineId)
    await submit(restoreReceiptRemaining, formData)
  }

  return (
    <div className="row no-print" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
      {showCancel ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setQuantity(String(remaining))
            setOpen(true)
          }}
        >
          <IconCancelRemaining size={14} aria-hidden />
          ยกเลิกยอดค้าง
        </button>
      ) : null}
      {showRestore ? (
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={handleRestore}>
          <IconUndo size={14} aria-hidden />
          คืนยอดค้าง
        </button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยกเลิกยอดค้าง — {name}</DialogTitle>
            <DialogDescription>
              ค้างรับอยู่ {formatNumber(remaining)} {unit} · ยอดที่ยกเลิกจะไม่รอรับอีก (สต็อกไม่เปลี่ยน) และคืนกลับได้ภายหลัง
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCancel} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor={`cancel-qty-${lineId}`}>
                จำนวนที่ยกเลิก ({unit}) <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id={`cancel-qty-${lineId}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={remaining}
                step={1}
                required
                className="input num"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {errors.quantity ? <p className="field-hint error">{errors.quantity}</p> : null}
            </div>
            <div className="field">
              <label className="t-small" htmlFor={`cancel-reason-${lineId}`}>
                เหตุผล <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id={`cancel-reason-${lineId}`}
                className="input"
                required
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น ผู้ขายของหมด"
              />
              {errors.reason ? <p className="field-hint error">{errors.reason}</p> : null}
            </div>
            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                ไม่ทำรายการ
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                ยืนยันยกเลิกยอดค้าง
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/// ยกเลิกรอบรับ 1 รอบ (STOCK_IN:DELETE)
export function VoidRoundButton({ roundId, label }: { roundId: string; label: string }) {
  const { submit } = useSubmit()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-danger btn-sm no-print" onClick={() => setOpen(true)}>
        <IconBan size={14} aria-hidden />
        ยกเลิกรอบนี้
      </button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={`ยกเลิก${label}`}
        description="ระบบจะตัดของที่รับในรอบนี้ออกจากสต็อกด้วยรายการชดเชย แล้วยอดกลับไปค้างรับ — ถ้าของถูกขาย/เบิกไปจนเหลือไม่พอ จะยกเลิกไม่ได้"
        placeholder="เช่น คีย์ผิด / ของถูกส่งคืน"
        confirmLabel="ยืนยันยกเลิกรอบรับ"
        danger
        onConfirm={(reason) => {
          const formData = new FormData()
          formData.set("id", roundId)
          formData.set("reason", reason)
          return submit(voidStockReceiptRound, formData)
        }}
      />
    </>
  )
}
