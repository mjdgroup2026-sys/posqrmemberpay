"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { resumeSales } from "@/app/actions/closing"
import { IconSpinner } from "@/components/icons"

/// ปุ่ม "เปิดรอบขายใหม่" (2026-10-08) — ปิดยอดแล้วรับเงินไม่ได้จนกว่าจะกด · ไม่แตะรอบที่ปิดไปแล้ว
export function ResumeSalesButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function resume() {
    setPending(true)
    try {
      const result = await resumeSales()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message ?? "เปิดรอบขายใหม่แล้ว")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ — ลองกด F5 แล้วทำใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <button type="button" className="btn btn-primary" onClick={resume} disabled={pending}>
      {pending ? <IconSpinner size={16} className="animate-spin" aria-hidden /> : null}
      เปิดรอบขายใหม่
    </button>
  )
}
