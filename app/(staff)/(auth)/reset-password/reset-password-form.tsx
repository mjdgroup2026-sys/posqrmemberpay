"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { IconSpinner } from "@/components/icons"
import { PasswordInput } from "@/components/password-input"

export function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 className="t-h2">ลิงก์ไม่ถูกต้อง</h1>
        <div className="alert-banner danger">
          ลิงก์ตั้งรหัสผ่านใหม่ไม่สมบูรณ์หรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่อีกครั้ง
        </div>
        <Link href="/forgot-password" className="btn btn-primary btn-block">
          ขอลิงก์ใหม่
        </Link>
      </div>
    )
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    if (password.length < 8) {
      setError("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร")
      return
    }
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน")
      return
    }

    setPending(true)
    const { error: authError } = await authClient.resetPassword({
      newPassword: password,
      token: token as string,
    })

    if (authError) {
      setPending(false)
      setError("ตั้งรหัสผ่านใหม่ไม่สำเร็จ — ลิงก์อาจหมดอายุแล้ว")
      return
    }

    toast.success("ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว")
    router.push("/login")
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 className="t-h2">ตั้งรหัสผ่านใหม่</h1>
        <p className="t-caption" style={{ marginTop: 4 }}>
          กรอกรหัสผ่านใหม่ที่ต้องการใช้
        </p>
      </div>

      {error ? <div className="alert-banner danger">{error}</div> : null}

      <div className="field">
        <label className="t-small" htmlFor="password">
          รหัสผ่านใหม่
        </label>
        <PasswordInput
          id="password"
          name="password"
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

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
        บันทึกรหัสผ่านใหม่
      </button>
    </form>
  )
}
