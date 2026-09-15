"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { IconSpinner } from "@/components/icons"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // รับเฉพาะ path ภายในเว็บ — กัน open redirect ผ่าน ?callbackUrl=https://evil
  const rawCallback = searchParams.get("callbackUrl") ?? "/"
  const callbackUrl = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/"
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function resendVerification() {
    if (!unverifiedEmail) return
    setPending(true)
    try {
      await authClient.sendVerificationEmail({ email: unverifiedEmail, callbackURL: "/verify-email" })
      setResent(true)
      toast.success("ส่งอีเมลยืนยันใหม่แล้ว กรุณาตรวจกล่องจดหมาย")
    } catch {
      toast.error("ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setUnverifiedEmail(null)
    setResent(false)
    setPending(true)

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "")
    const { error: authError } = await authClient.signIn.email({
      email,
      password: String(form.get("password") ?? ""),
    })

    if (authError) {
      setPending(false)
      // บัญชีถูกต้องแต่ยังไม่ยืนยันอีเมล — ต้องบอกให้ตรงจุด ไม่งั้นผู้ใช้ไล่แก้รหัสผ่านไปเรื่อย
      if (authError.code === "EMAIL_NOT_VERIFIED" || authError.status === 403) {
        setUnverifiedEmail(email)
        setError("บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณากดลิงก์ในอีเมลที่ส่งไปให้ก่อนเข้าสู่ระบบ")
        return
      }
      setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง")
      return
    }

    toast.success("เข้าสู่ระบบสำเร็จ")
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 className="t-h2">เข้าสู่ระบบ</h1>
        <p className="t-caption" style={{ marginTop: 4 }}>
          กรอกอีเมลและรหัสผ่านเพื่อเข้าใช้งานระบบหลังร้าน
        </p>
      </div>

      {error ? <div className="alert-banner danger">{error}</div> : null}

      {unverifiedEmail && !resent ? (
        <button type="button" className="btn btn-subtle btn-block" disabled={pending} onClick={resendVerification}>
          ส่งอีเมลยืนยันอีกครั้ง
        </button>
      ) : null}

      <div className="field">
        <label className="t-small" htmlFor="email">
          อีเมล
        </label>
        <input id="email" name="email" type="email" className="input" required autoComplete="email" />
      </div>

      <div className="field">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label className="t-small" htmlFor="password">
            รหัสผ่าน
          </label>
          <Link href="/forgot-password" className="t-caption" style={{ color: "var(--brand)" }}>
            ลืมรหัสผ่าน?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          required
          autoComplete="current-password"
        />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
        เข้าสู่ระบบ
      </button>

      <p className="t-caption" style={{ textAlign: "center" }}>
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" style={{ color: "var(--brand)", fontWeight: 500 }}>
          สมัครสมาชิก
        </Link>
      </p>
    </form>
  )
}
