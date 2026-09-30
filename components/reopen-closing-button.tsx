"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { reopenCashierClosing } from "@/app/actions/closing"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { IconSpinner, IconUndo } from "@/components/icons"

/// ปุ่มเปิดรอบที่ปิดแล้วใหม่ (2026-09-30) — หน้าเป็นคนตัดสินว่าแสดงไหม (สิทธิ์ POS_CLOSING:EDIT + เป็นรอบล่าสุด)
/// ด่านจริงอยู่ที่ reopenCashierClosing · บังคับเหตุผลอย่างน้อย 5 ตัวอักษร (ตรงกับ reopenClosingSchema)
export function ReopenClosingButton({ closingId, roundNo }: { closingId: string; roundNo: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)

    const formData = new FormData()
    formData.set("id", closingId)
    formData.set("reason", reason)

    try {
      const result = await reopenCashierClosing(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
      setReason("")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <IconUndo size={14} aria-hidden />
        เปิดรอบใหม่
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>เปิดรอบที่ {roundNo} ใหม่</DialogTitle>
            <DialogDescription>
              บิลของรอบนี้จะกลับไปเป็น &quot;ยังไม่ปิดรอบ&quot; (ยกเลิกบิลได้อีกครั้ง) แล้วแคชเชียร์ต้องนับเงินและปิดเป็นรอบถัดไป ·
              รอบเดิมยังเก็บไว้ในประวัติพร้อมชื่อคนเปิดและเหตุผล
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="reopen-reason">
                เหตุผลที่เปิดรอบใหม่ <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="reopen-reason"
                className="input"
                required
                minLength={5}
                maxLength={200}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น นับเงินผิด / ต้องยกเลิกบิลที่คีย์ผิด"
              />
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                ไม่เปิด
              </button>
              <button type="submit" className="btn btn-danger-solid" disabled={pending || reason.trim().length < 5}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                ยืนยันเปิดรอบใหม่
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
