"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { reopenStore } from "@/app/actions/store-lifecycle"
import { IconSpinner, IconUndo } from "@/components/icons"

/// ปุ่ม "เปิดร้านอีกครั้ง" บน /no-store (2026-09-30) — ด่านจริงอยู่ที่ reopenStore (OWNER ของร้านนั้นเท่านั้น)
export function ReopenStoreButton({ storeId, storeName }: { storeId: string; storeName: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleClick() {
    if (!window.confirm(`เปิดร้าน "${storeName}" อีกครั้ง? พนักงานจะกลับมาเข้าร้านได้และลูกค้าสแกน QR สั่งอาหารได้ตามปกติ`)) return
    setPending(true)
    const formData = new FormData()
    formData.set("storeId", storeId)
    try {
      const result = await reopenStore(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.push("/")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <button type="button" className="btn btn-primary btn-sm" onClick={handleClick} disabled={pending}>
      {pending ? <IconSpinner size={15} className="animate-spin" aria-hidden /> : <IconUndo size={15} aria-hidden />}
      เปิดร้านอีกครั้ง
    </button>
  )
}
