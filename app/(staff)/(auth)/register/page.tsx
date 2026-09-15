import { Suspense } from "react"
import { RegisterForm } from "./register-form"

export const metadata = { title: "สมัครสมาชิก" }

/// useSearchParams() ในฟอร์ม (อีเมลจากลิงก์เชิญ + callbackUrl) ต้องมี Suspense ครอบ ไม่งั้น build พัง
export default function RegisterPage() {
  return (
    <Suspense fallback={<p className="t-body">กำลังโหลด…</p>}>
      <RegisterForm />
    </Suspense>
  )
}
