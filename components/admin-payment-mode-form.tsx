"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setStorePaymentMode } from "@/app/actions/admin"
import { IconWallet } from "@/components/icons"

/// ผู้ดูแลแพลตฟอร์มเปลี่ยนวิธีรับเงินของร้าน (Phase 15a) — ที่เดียวที่ตั้ง SCB_BILLER ได้ในเฟสนี้

type Mode = "PROMPTPAY_DIRECT" | "PROMPTPAY_SLIP" | "SCB_BILLER"

const LABEL: Record<Mode, string> = {
  PROMPTPAY_DIRECT: "พร้อมเพย์ตรง (พนักงานกดยืนยัน)",
  PROMPTPAY_SLIP: "พร้อมเพย์ + ตรวจสลิป (15b — ยังไม่เปิด)",
  SCB_BILLER: "SCB Biller — ปิดบิลอัตโนมัติ (env ของแพลตฟอร์ม)",
}

export function AdminPaymentModeForm({ storeId, current, scbReady }: { storeId: string; current: Mode; scbReady: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [mode, setMode] = useState<Mode>(current)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === current) return
    if (mode === "SCB_BILLER" && !confirm("เปิดโหมด SCB ให้ร้านนี้? ลูกค้าของร้านจะจ่ายเข้าบัญชี SCB ตาม SCB_BILLER_ID ใน env — ต้องเป็นบัญชีของร้านนี้จริง")) return
    setPending(true)
    try {
      const fd = new FormData()
      fd.set("storeId", storeId)
      fd.set("paymentMode", mode)
      const result = await setStorePaymentMode(fd)
      if (!result.ok) {
        toast.error(result.error)
        setMode(current)
        return
      }
      toast.success(result.message)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <IconWallet size={16} aria-hidden />
      <select className="select" value={mode} onChange={(e) => setMode(e.target.value as Mode)} disabled={pending} style={{ minWidth: 260 }}>
        {(Object.keys(LABEL) as Mode[]).map((m) => (
          <option key={m} value={m} disabled={m === "PROMPTPAY_SLIP" || (m === "SCB_BILLER" && !scbReady)}>
            {LABEL[m]}
            {m === "SCB_BILLER" && !scbReady ? " — ยังไม่ตั้ง env" : ""}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending || mode === current}>
        เปลี่ยนวิธีรับเงิน
      </button>
    </form>
  )
}
