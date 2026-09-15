"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { acceptInvite } from "@/app/actions/store-members"
import { IconCheck, IconSpinner } from "@/components/icons"

/// ปุ่มตอบรับคำเชิญ (Phase 14a) — ใช้ทั้งบน /invite/[token] (ส่ง token) และ /no-store (ส่ง inviteId)
export function AcceptInviteButton({
  token,
  inviteId,
  storeName,
  compact = false,
}: {
  token?: string
  inviteId?: string
  storeName: string
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function accept() {
    setPending(true)
    const formData = new FormData()
    if (token) formData.set("token", token)
    if (inviteId) formData.set("inviteId", inviteId)
    try {
      const result = await acceptInvite(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      // cookie ชี้ร้านที่เข้าร่วมแล้ว — ไปหน้าแรกของร้านนั้น
      router.push("/")
      router.refresh()
    } catch {
      toast.error("เข้าร่วมร้านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      className={compact ? "btn btn-primary btn-sm" : "btn btn-primary btn-block"}
      disabled={pending}
      onClick={() => void accept()}
    >
      {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : <IconCheck size={17} aria-hidden />}
      {compact ? "เข้าร่วม" : `เข้าร่วมร้าน ${storeName}`}
    </button>
  )
}
