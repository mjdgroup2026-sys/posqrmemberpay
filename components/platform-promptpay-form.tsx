"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updatePlatformPromptPay } from "@/app/actions/platform-settings"
import type { FieldErrors } from "@/lib/types"
import { IconSave, IconSpinner } from "@/components/icons"

/// ฟอร์มพร้อมเพย์ของแพลตฟอร์ม (2026-10-05 · /admin/settings) — เฉพาะผู้ดูแลแพลตฟอร์ม (action ตรวจซ้ำ)
export function PlatformPromptPayForm({ promptPayId, promptPayName }: { promptPayId: string; promptPayName: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})
    try {
      const result = await updatePlatformPromptPay(new FormData(event.currentTarget))
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="field">
        <label className="t-small" htmlFor="platform-promptpay-id">
          เลขพร้อมเพย์
        </label>
        <input
          id="platform-promptpay-id"
          name="promptPayId"
          className="input num"
          inputMode="numeric"
          defaultValue={promptPayId}
          placeholder="0812345678"
          maxLength={32}
        />
        <span className="field-hint">เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน/นิติบุคคล 13 หลัก · เว้นว่าง = ใช้ค่าจากเซิร์ฟเวอร์ (ถ้ามี)</span>
        {fieldErrors.promptPayId ? <span className="field-hint error">{fieldErrors.promptPayId}</span> : null}
      </div>
      <div className="field">
        <label className="t-small" htmlFor="platform-promptpay-name">
          ชื่อบัญชีผู้รับ
        </label>
        <input
          id="platform-promptpay-name"
          name="promptPayName"
          className="input"
          defaultValue={promptPayName}
          placeholder="ชื่อที่ขึ้นในแอปธนาคารตอนโอน"
          maxLength={80}
        />
        <span className="field-hint">โชว์ใต้ QR ให้ร้านเทียบกับชื่อในแอปธนาคารก่อนกดโอน</span>
        {fieldErrors.promptPayName ? <span className="field-hint error">{fieldErrors.promptPayName}</span> : null}
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? <IconSpinner size={16} className="animate-spin" aria-hidden /> : <IconSave size={16} aria-hidden />}
          บันทึก
        </button>
      </div>
    </form>
  )
}
