"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { removeStoreMember, setStoreMemberRole } from "@/app/actions/store-members"

/// ปุ่มของเจ้าของร้านบนหน้า /users (Phase 13) — เลื่อนเป็นเจ้าของ / ลดเป็นพนักงาน / ถอดออกจากร้าน
/// action ฝั่ง server เป็นด่านจริง (requireOwner + กัน OWNER คนสุดท้าย) — ปุ่มนี้แค่ไม่ให้งง
export function StoreMemberControls({
  userId,
  storeRole,
  isSelf,
}: {
  userId: string
  storeRole: "OWNER" | "STAFF"
  isSelf: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function run(action: (formData: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>, fields: Record<string, string>) {
    setPending(true)
    const formData = new FormData()
    for (const [key, value] of Object.entries(fields)) formData.set(key, value)
    try {
      const result = await action(formData)
      if (!result.ok) {
        toast.error(result.error ?? "ทำรายการไม่สำเร็จ")
        return
      }
      toast.success(result.message ?? "บันทึกแล้ว")
      router.refresh()
    } catch {
      toast.error("ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
      {storeRole === "OWNER" ? (
        <button
          type="button"
          className="btn btn-subtle btn-sm"
          disabled={pending || isSelf}
          title={isSelf ? "ให้เจ้าของร้านคนอื่นเป็นคนเปลี่ยนบทบาทของคุณ" : undefined}
          onClick={() => void run(setStoreMemberRole, { userId, role: "STAFF" })}
        >
          ลดเป็นพนักงาน
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-subtle btn-sm"
          disabled={pending}
          onClick={() => void run(setStoreMemberRole, { userId, role: "OWNER" })}
        >
          ตั้งเป็นเจ้าของร้าน
        </button>
      )}
      <button
        type="button"
        className="btn btn-danger btn-sm"
        disabled={pending || isSelf}
        onClick={() => {
          if (!window.confirm("ถอดพนักงานคนนี้ออกจากร้าน? บัญชีของเขายังอยู่ แต่จะไม่เห็นข้อมูลของร้านนี้อีก")) return
          void run(removeStoreMember, { userId })
        }}
      >
        ถอดออก
      </button>
    </div>
  )
}
