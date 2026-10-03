"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { IconSpinner } from "@/components/icons"

type ExistingCode = "EMAIL_ALREADY_REGISTERED" | "EMAIL_REGISTERED_UNVERIFIED"

/// สมัครสมาชิกเอง — นโยบายอยู่ฝั่ง server (lib/signup-allowlist.ts → hooks.before ใน lib/auth.ts):
/// SIGNUP_OPEN=true ใครก็สมัครได้ (Phase 14a) หรือ allowlist เดิม
///
/// สมัครเสร็จ **ยังล็อกอินไม่ได้ทันที** เพราะ `requireEmailVerification: true`
/// หน้าจึงเปลี่ยนเป็นการ์ด "ตรวจอีเมลของคุณ" แทนการเด้งไปหน้าแรก ซึ่งจะถูกดีดกลับ /login อยู่ดี
///
/// มาจากลิงก์เชิญเข้าร้าน: ?email= เติมอีเมลที่ถูกเชิญให้ (แก้ได้แต่จะรับคำเชิญไม่ได้ถ้าไม่ตรง)
/// และ ?callbackUrl= ส่งต่อไปปุ่ม "เข้าสู่ระบบ" — ถ้าลิงก์หายระหว่างยืนยันอีเมล หน้า /no-store
/// ก็ยังแสดงคำเชิญค้างของอีเมลนี้ให้กดเข้าร่วมได้
export function RegisterForm() {
  const searchParams = useSearchParams()
  const presetEmail = searchParams.get("email") ?? ""
  const rawCallback = searchParams.get("callbackUrl") ?? ""
  // รับเฉพาะ path ภายในเว็บ — กัน open redirect
  const callbackUrl = rawCallback.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : ""
  const loginHref = callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login"
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // อีเมลซ้ำ — แยกจาก error ทั่วไปเพราะต้องโชว์ปุ่มทางไปต่อ (เข้าสู่ระบบ / ส่งอีเมลยืนยันซ้ำ)
  const [conflict, setConflict] = useState<{ code: ExistingCode; email: string } | null>(null)
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setConflict(null)
    setResent(false)

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "")
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
    const { error: authError } = await authClient.signUp.email({
      name: String(form.get("name") ?? ""),
      email,
      password,
    })

    if (authError) {
      setPending(false)
      // 403 = อีเมลไม่อยู่ใน allowlist — ข้อความจาก server บอกสาเหตุตรงจุดแล้ว ใช้ต่อได้เลย
      if (authError.status === 403) {
        setError(authError.message ?? "อีเมลนี้ยังสมัครไม่ได้ กรุณาติดต่อผู้ดูแลระบบ")
        return
      }
      // 422 + code จาก hooks.before ใน lib/auth.ts (lib/signup-existing.ts)
      if (authError.code === "EMAIL_ALREADY_REGISTERED" || authError.code === "EMAIL_REGISTERED_UNVERIFIED") {
        setConflict({ code: authError.code, email })
        return
      }
      setError(
        authError.status === 422 ? "อีเมลนี้ถูกใช้สมัครไปแล้ว" : "สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      )
      return
    }

    setPending(false)
    setRegisteredEmail(email)
  }

  async function resend(email: string | null) {
    if (!email) return
    setPending(true)
    // Better Auth client ไม่ throw เมื่อเซิร์ฟเวอร์ตอบ error — ต้องเช็ค { error } เอง
    const { error: sendError } = await authClient.sendVerificationEmail({ email, callbackURL: "/verify-email" })
    setPending(false)
    if (sendError) {
      toast.error("ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return
    }
    setResent(true)
    toast.success("ส่งอีเมลยืนยันใหม่แล้ว")
  }

  if (registeredEmail) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h1 className="t-h2">ตรวจอีเมลของคุณ</h1>
          <p className="t-caption" style={{ marginTop: 4 }}>
            เราส่งลิงก์ยืนยันไปที่ <span className="num">{registeredEmail}</span> แล้ว
            กดลิงก์ในอีเมลเพื่อเปิดใช้งานบัญชี
          </p>
        </div>

        <div className="alert-banner info">
          ต้องยืนยันอีเมลก่อนจึงเข้าสู่ระบบได้ · ถ้าไม่เจอในกล่องจดหมาย ลองดูในเมลขยะ
        </div>

        {resent ? <div className="alert-banner info">ส่งลิงก์ยืนยันใหม่ให้แล้ว</div> : null}

        <button
          type="button"
          className="btn btn-subtle btn-block"
          disabled={pending || resent}
          onClick={() => resend(registeredEmail)}
        >
          {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
          ส่งอีเมลยืนยันอีกครั้ง
        </button>

        <Link href={loginHref} className="btn btn-primary btn-block">
          ไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 className="t-h2">สมัครสมาชิก</h1>
        <p className="t-caption" style={{ marginTop: 4 }}>
          สร้างบัญชีใหม่ — สมัครแล้วสร้างร้านของคุณเอง หรือตอบรับคำเชิญจากเจ้าของร้าน
        </p>
      </div>

      {error ? <div className="alert-banner danger">{error}</div> : null}

      {conflict ? (
        <div className="alert-banner warning" role="alert" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span>
            {conflict.code === "EMAIL_ALREADY_REGISTERED" ? (
              <>
                อีเมล <span className="num">{conflict.email}</span> มีบัญชีอยู่แล้ว ไม่ต้องสมัครใหม่ —
                เข้าสู่ระบบได้เลย หรือกดลืมรหัสผ่านหากจำรหัสผ่านไม่ได้
              </>
            ) : (
              <>
                อีเมล <span className="num">{conflict.email}</span> สมัครไว้แล้วแต่ยังไม่ได้ยืนยัน ไม่ต้องสมัครใหม่ —
                กดลิงก์ในอีเมลที่ส่งไปก่อนหน้า หรือขอส่งอีเมลยืนยันอีกครั้ง
              </>
            )}
          </span>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {conflict.code === "EMAIL_ALREADY_REGISTERED" ? (
              <>
                <Link href={loginHref} className="btn btn-primary btn-sm">
                  เข้าสู่ระบบ
                </Link>
                <Link href="/forgot-password" className="btn btn-ghost btn-sm">
                  ลืมรหัสผ่าน
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={pending || resent}
                  onClick={() => resend(conflict.email)}
                >
                  {pending ? <IconSpinner size={15} className="animate-spin" aria-hidden /> : null}
                  {resent ? "ส่งอีเมลยืนยันแล้ว" : "ส่งอีเมลยืนยันอีกครั้ง"}
                </button>
                <Link href={loginHref} className="btn btn-ghost btn-sm">
                  ไปหน้าเข้าสู่ระบบ
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="field">
        <label className="t-small" htmlFor="name">
          ชื่อผู้ใช้งาน
        </label>
        <input id="name" name="name" className="input" required autoComplete="name" />
      </div>

      <div className="field">
        <label className="t-small" htmlFor="email">
          อีเมล
        </label>
        <input id="email" name="email" type="email" className="input" required autoComplete="email" defaultValue={presetEmail} />
        {presetEmail ? <span className="field-hint">ต้องใช้อีเมลนี้จึงจะตอบรับคำเชิญเข้าร้านได้</span> : null}
      </div>

      <div className="field">
        <label className="t-small" htmlFor="password">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <span className="field-hint">อย่างน้อย 8 ตัวอักษร</span>
      </div>

      <div className="field">
        <label className="t-small" htmlFor="confirmPassword">
          ยืนยันรหัสผ่าน
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          className="input"
          required
          autoComplete="new-password"
        />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
        สมัครสมาชิก
      </button>

      <p className="t-caption" style={{ textAlign: "center" }}>
        มีบัญชีอยู่แล้ว?{" "}
        <Link href={loginHref} style={{ color: "var(--brand)", fontWeight: 500 }}>
          เข้าสู่ระบบ
        </Link>
      </p>
    </form>
  )
}
