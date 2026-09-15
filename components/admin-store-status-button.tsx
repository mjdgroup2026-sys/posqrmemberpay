"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setStoreStatus } from "@/app/actions/admin"
import { IconBan, IconCheck } from "@/components/icons"

/// ปุ่มระงับ/ปลดระงับร้าน (Phase 14a) — เฉพาะผู้ดูแลแพลตฟอร์ม · ด่านจริงคือ requirePlatformAdmin() ใน action
export function AdminStoreStatusButton({ storeId, status, storeName }: { storeId: string; status: "ACTIVE" | "SUSPENDED"; storeName: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const suspend = status === "ACTIVE"

  async function toggle() {
    if (suspend && !window.confirm(`ระงับร้าน "${storeName}"? สมาชิกทุกคนของร้านจะใช้งานไม่ได้และลูกค้าสั่งอาหารไม่ได้จนกว่าจะปลดระงับ`)) return
    setPending(true)
    const formData = new FormData()
    formData.set("storeId", storeId)
    formData.set("status", suspend ? "SUSPENDED" : "ACTIVE")
    try {
      const result = await setStoreStatus(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      className={suspend ? "btn btn-danger btn-sm" : "btn btn-subtle btn-sm"}
      disabled={pending}
      onClick={() => void toggle()}
    >
      {suspend ? <IconBan size={14} aria-hidden /> : <IconCheck size={14} aria-hidden />}
      {suspend ? "ระงับ" : "ปลดระงับ"}
    </button>
  )
}
