// ไม่ใส่ "server-only" — lib/auth.ts ถูก import จาก prisma/create-user.ts ที่รันด้วย node ตรง ๆ
import { prisma } from "@/lib/prisma"

/// สมัครซ้ำด้วยอีเมลที่มีบัญชีแล้ว — ต้องบอกผู้ใช้ตรง ๆ (เจ้าของระบบสั่ง 2026-10-03)
///
/// Better Auth 1.7 เมื่อเปิด `requireEmailVerification` จะตอบ "สมัครสำเร็จ" แบบหลอกให้อีเมลซ้ำ
/// (กันไล่เดาว่าอีเมลไหนมีบัญชี) ผู้ใช้จึงเห็นการ์ด "ตรวจอีเมลของคุณ" แล้วรออีเมลที่ไม่มีวันมา
/// → `hooks.before` ใน lib/auth.ts เรียกตัวนี้ก่อนถึง Better Auth แล้วตอบ 422 พร้อม code แทน
/// · ยอมเปิดเผยว่าอีเมลมีบัญชีโดยตั้งใจ — หน้า /login ก็บอกอยู่แล้วผ่าน EMAIL_NOT_VERIFIED
export type SignupConflict = "EMAIL_ALREADY_REGISTERED" | "EMAIL_REGISTERED_UNVERIFIED"

export async function findSignupConflict(rawEmail: string): Promise<SignupConflict | null> {
  // Better Auth เก็บอีเมลเป็นตัวพิมพ์เล็ก — ค้นแบบไม่สนตัวพิมพ์เผื่อแถวที่สร้างจากทางอื่น
  const email = rawEmail.trim()
  if (!email) return null

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { emailVerified: true },
  })
  if (!user) return null
  return user.emailVerified ? "EMAIL_ALREADY_REGISTERED" : "EMAIL_REGISTERED_UNVERIFIED"
}

export const SIGNUP_CONFLICT_MESSAGE: Record<SignupConflict, string> = {
  EMAIL_ALREADY_REGISTERED: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ หรือกดลืมรหัสผ่านหากจำรหัสผ่านไม่ได้",
  EMAIL_REGISTERED_UNVERIFIED: "อีเมลนี้สมัครไว้แล้วแต่ยังไม่ได้ยืนยัน กรุณากดลิงก์ในอีเมล หรือขอส่งอีเมลยืนยันอีกครั้ง",
}
