"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  cancelReceiptRemaining,
  closeStockReceipt,
  receiveStockRound,
  restoreReceiptRemaining,
  voidStockReceiptRound,
} from "@/app/actions/stock-docs"
import { formatNumber } from "@/lib/format"
import type { ActionResult, FieldErrors } from "@/lib/types"
import { IconBan, IconCancelRemaining, IconEdit, IconSpinner, IconTruck, IconUndo } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/// ปุ่มของใบรับแบบร่าง + รับหลายรอบ (Phase 21d) — ใช้บนหน้า `/stock/receipts/[id]`
/// · การมองเห็นปุ่มมาจากสิทธิ์ที่หน้าคำนวณให้ (`STOCK_IN` ADD/DELETE) · ด่านจริงอยู่ใน action ทุกตัว

export type ReceivableLine = { lineId: string; name: string; sku: string; unit: string; remaining: number }

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
  editHref,
  lines,
  today,
  canAdd,
}: {
  documentId: string
  docNumber: string
  editHref: string
  lines: ReceivableLine[]
  today: string
  /// ใบยังค้างรับ + มีสิทธิ์ STOCK_IN:ADD
  canAdd: boolean
}) {
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  if (!canAdd) return null

  return (
    <>
      <Link href={editHref} className="btn btn-subtle">
        <IconEdit size={17} aria-hidden />
        แก้ไขใบรับ
      </Link>
      <button type="button" className="btn btn-subtle" onClick={() => setCloseOpen(true)}>
        <IconCancelRemaining size={17} aria-hidden />
        ปิดใบ
      </button>
      <button type="button" className="btn btn-primary" onClick={() => setReceiveOpen(true)}>
        <IconTruck size={17} aria-hidden />
        รับสินค้า
      </button>

      <ReceiveDialog
        // ยอดค้างเปลี่ยนหลังรับแต่ละรอบ — remount ให้ช่องจำนวนตั้งต้นที่ยอดค้างล่าสุด
        key={lines.map((line) => `${line.lineId}:${line.remaining}`).join(",")}
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        documentId={documentId}
        docNumber={docNumber}
        lines={lines}
        today={today}
      />
      <CloseDialog open={closeOpen} onOpenChange={setCloseOpen} documentId={documentId} docNumber={docNumber} />
    </>
  )
}

function ReceiveDialog({
  open,
  onOpenChange,
  documentId,
  docNumber,
  lines,
  today,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId: string
  docNumber: string
  lines: ReceivableLine[]
  today: string
}) {
  const { pending, errors, submit } = useSubmit()
  const [receivedDate, setReceivedDate] = useState(today)
  const [referenceNo, setReferenceNo] = useState("")
  const [note, setNote] = useState("")
  // ตั้งต้นที่ยอดค้างทั้งหมด — ของมาครบก็กดบันทึกได้เลย มาไม่ครบค่อยแก้เป็นจำนวนจริง
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.lineId, String(line.remaining)])),
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set("documentId", documentId)
    formData.set("receivedDate", receivedDate)
    formData.set("referenceNo", referenceNo)
    formData.set("note", note)
    formData.set("lines", JSON.stringify(lines.map((line) => ({ lineId: line.lineId, quantity: qty[line.lineId] || "0" }))))
    if (await submit(receiveStockRound, formData)) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>รับสินค้า {docNumber}</DialogTitle>
          <DialogDescription>กรอกจำนวนที่ได้รับจริงในรอบนี้ — สต็อกเพิ่มเฉพาะจำนวนที่กรอก ยอดที่เหลือรอรับรอบถัดไปได้</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field-grid">
            <div className="field">
              <label className="t-small" htmlFor="round-date">
                วันที่รับสินค้า <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input id="round-date" type="date" className="input num" value={receivedDate} max={today} required onChange={(e) => setReceivedDate(e.target.value)} />
              {errors.receivedDate ? <p className="field-hint error">{errors.receivedDate}</p> : null}
            </div>
            <div className="field">
              <label className="t-small" htmlFor="round-ref">
                เลขที่ใบส่งของ
              </label>
              <input id="round-ref" className="input num" value={referenceNo} maxLength={60} onChange={(e) => setReferenceNo(e.target.value)} />
            </div>
            <div className="field">
              <label className="t-small" htmlFor="round-note">
                หมายเหตุ
              </label>
              <input id="round-note" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "8px 12px", fontWeight: 500 }}>สินค้า</th>
                  <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>ค้างรับ</th>
                  <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "right" }}>รับรอบนี้</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.lineId} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 12px" }}>
                      <div style={{ fontWeight: 500 }}>{line.name}</div>
                      <div className="t-caption num">{line.sku}</div>
                    </td>
                    <td className="num" style={{ padding: "8px 12px", textAlign: "right" }}>
                      {formatNumber(line.remaining)} {line.unit}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={line.remaining}
                        step={1}
                        className="input num"
                        style={{ width: 110, textAlign: "right" }}
                        aria-label={`จำนวนรับรอบนี้ ${line.name}`}
                        value={qty[line.lineId] ?? ""}
                        onChange={(e) => setQty((prev) => ({ ...prev, [line.lineId]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errors.lines ? <p className="field-hint error">{errors.lines}</p> : null}

          <DialogFooter>
            <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)}>
              ยกเลิก
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : <IconTruck size={17} aria-hidden />}
              บันทึกการรับรอบนี้
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
