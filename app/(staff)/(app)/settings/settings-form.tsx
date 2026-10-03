"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updateProfile } from "@/app/actions/profile"
import { authClient } from "@/lib/auth-client"
import type { FieldErrors } from "@/lib/types"
import { IconSpinner } from "@/components/icons"
import { PasswordInput } from "@/components/password-input"

export function SettingsForm({ name, email }: { name: string; email: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [pwPending, setPwPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [pwError, setPwError] = useState<string | null>(null)

  async function handleProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const result = await updateProfile(new FormData(event.currentTarget))
    setPending(false)

    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {})
      toast.error(result.error)
      return
    }
    toast.success(result.message)
    router.refresh()
  }

  async function handlePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPwError(null)

    const form = new FormData(event.currentTarget)
    const newPassword = String(form.get("newPassword") ?? "")
    if (newPassword.length < 8) {
      setPwError("รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร")
      return
    }
    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setPwError("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน")
      return
    }

    setPwPending(true)
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword,
      revokeOtherSessions: true,
    })
    setPwPending(false)

    if (error) {
      setPwError("เปลี่ยนรหัสผ่านไม่สำเร็จ — ตรวจว่ารหัสผ่านปัจจุบันถูกต้อง")
      return
    }
    toast.success("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว")
    event.currentTarget.reset()
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, alignItems: "start" }}>
      <section className="card-ui card-pad">
        <h2 className="t-h2" style={{ marginBottom: 4 }}>
          ข้อมูลโปรไฟล์
        </h2>
        <p className="t-caption" style={{ marginBottom: 18 }}>
          แก้ชื่อที่แสดงในระบบ
        </p>

        <form onSubmit={handleProfile} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field">
            <label className="t-small" htmlFor="name">
              ชื่อผู้ใช้งาน
            </label>
            <input id="name" name="name" className="input" required defaultValue={name} />
            {fieldErrors.name ? <span className="field-hint error">{fieldErrors.name}</span> : null}
          </div>

          <div className="field">
            <label className="t-small" htmlFor="email">
              อีเมล
            </label>
            <input id="email" className="input" value={email} disabled />
            <span className="field-hint">อีเมลใช้เป็นรหัสเข้าระบบ เปลี่ยนเองไม่ได้</span>
          </div>

          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
            บันทึกโปรไฟล์
          </button>
        </form>
      </section>

      <section className="card-ui card-pad">
        <h2 className="t-h2" style={{ marginBottom: 4 }}>
          เปลี่ยนรหัสผ่าน
        </h2>
        <p className="t-caption" style={{ marginBottom: 18 }}>
          เปลี่ยนแล้วระบบจะออกจากระบบอุปกรณ์อื่นทั้งหมด
        </p>

        <form onSubmit={handlePassword} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {pwError ? <div className="alert-banner danger">{pwError}</div> : null}

          <div className="field">
            <label className="t-small" htmlFor="currentPassword">
              รหัสผ่านปัจจุบัน
            </label>
            <PasswordInput
              id="currentPassword"
              name="currentPassword"
              required
              autoComplete="current-password"
            />
          </div>

          <div className="field">
            <label className="t-small" htmlFor="newPassword">
              รหัสผ่านใหม่
            </label>
            <PasswordInput
              id="newPassword"
              name="newPassword"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <span className="field-hint">อย่างน้อย 8 ตัวอักษร</span>
          </div>

          <div className="field">
            <label className="t-small" htmlFor="confirmPassword">
              ยืนยันรหัสผ่านใหม่
            </label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              required
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn btn-subtle" disabled={pwPending}>
            {pwPending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
            เปลี่ยนรหัสผ่าน
          </button>
        </form>
      </section>
    </div>
  )
}
