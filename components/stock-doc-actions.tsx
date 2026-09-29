"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { voidStockDoc } from "@/app/actions/stock-docs"
import { IconBan, IconPrinter, IconSpinner } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/// ปุ่มพิมพ์ + ยกเลิกเอกสารคลัง (Phase 21) — `canVoid` มาจากสิทธิ์ DELETE ของ resource ที่หน้าคำนวณให้ (ด่านจริงอยู่ใน action)
export function StockDocActions({
  id,
  docNumber,
  canVoid,
  voidHint,
  children,
}: {
  id: string
  docNumber: string
  canVoid: boolean
  voidHint: string
  /// ปุ่มเพิ่มเติมของเอกสารประเภทนั้น (ใบรับ 21d: แก้ไข/ปิดใบ/รับสินค้า) — วางต่อท้ายแถวเดียวกัน
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)

  async function handleVoid(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    const formData = new FormData()
    formData.set("id", id)
    formData.set("reason", reason)
    try {
      const result = await voidStockDoc(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="row no-print" style={{ gap: 10, flexWrap: "wrap" }}>
      <button type="button" className="btn btn-subtle" onClick={() => window.print()}>
        <IconPrinter size={17} aria-hidden />
        พิมพ์เอกสาร
      </button>
      {canVoid ? (
        <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
          <IconBan size={17} aria-hidden />
          ยกเลิกเอกสาร
        </button>
      ) : null}
      {children}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยกเลิก {docNumber}</DialogTitle>
            <DialogDescription>{voidHint}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleVoid} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="void-reason">
                เหตุผลที่ยกเลิก <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="void-reason"
                className="input"
                required
                autoFocus
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น คีย์ผิด / บันทึกซ้ำ"
              />
            </div>
            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                ไม่ยกเลิก
              </button>
              <button type="submit" className="btn btn-danger-solid" disabled={pending}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                ยืนยันยกเลิกเอกสาร
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
