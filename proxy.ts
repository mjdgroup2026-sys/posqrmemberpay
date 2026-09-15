import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

// เส้นทางสาธารณะที่ "ห้าม" redirect ไม่ว่าจะล็อกอินอยู่หรือไม่
// /api/health ต้องอยู่ในนี้ — ถ้าโดน redirect ตัวตรวจสุขภาพจะได้ 307 แทน 200/503
// แล้ว HEALTHCHECK ของ container กับ nginx จะอ่านผลผิดทั้งหมด
const ALWAYS_PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/health",
  // ปลายทางหลังกดลิงก์ในอีเมล — ผู้ใช้ยังไม่มี session ตอนกด และคนที่ยืนยันแล้วก็ต้องเห็นผลลัพธ์
  // จึงเป็น public เต็มตัว ไม่ใช่ AUTH_PAGE ที่เด้งคนล็อกอินอยู่กลับหน้าแรก
  "/verify-email",
  "/order", // ฝั่งลูกค้า (Phase 9) — สแกน QR เข้าได้เลย ไม่ต้องล็อกอิน
  "/api/order", // endpoint โพลสถานะของหน้าลูกค้า — ยึด qrToken เป็นตัวระบุตัวตน ไม่มี session
  // callback การชำระเงินจากธนาคาร (Phase 10) — ผู้เรียกคือเซิร์ฟเวอร์ของธนาคาร ไม่มี cookie ใด ๆ
  // ถ้าไม่อยู่ในลิสต์นี้จะโดนเด้ง 307 ไป /login แล้ว handler ไม่เคยทำงาน ธนาคารจะ retry ไม่รู้จบ
  // ด่านความปลอดภัยของเส้นทางนี้อยู่ในตัว route เอง (path secret + ตรวจยอด + inquiry กลับไปที่ธนาคาร)
  "/api/payments",
  // ลิงก์เชิญเข้าร้าน (Phase 14a) — ผู้รับยังไม่มีบัญชีตอนกด และคนที่ล็อกอินอยู่ก็ต้องเห็นปุ่มตอบรับ
  // ด่านจริงอยู่ที่ acceptInvite (ต้องล็อกอินด้วยอีเมลที่ถูกเชิญ) ไม่ใช่การซ่อนหน้า
  "/invite",
  // งานตามเวลา (Phase 14b) — ผู้เรียกคือ cron บน VPS ไม่มี cookie · ด่านคือ secret ใน path (ตอบ 401 ถ้าผิด)
  "/api/cron",
]

// หน้า auth ของพนักงาน — เข้าได้โดยไม่ต้องล็อกอิน แต่ถ้าล็อกอินอยู่แล้วให้เด้งกลับหน้าแรก
// "/register" เปิดคืนแล้วใน Phase 5 — ด่านจริงที่กันคนนอกคือ allowlist ใน lib/auth.ts
// ไม่ใช่การซ่อนหน้านี้ (endpoint /api/auth/sign-up/email เรียกตรงได้อยู่ดี)
const AUTH_PAGE_PREFIXES = ["/login", "/register", "/forgot-password", "/reset-password"]

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (matches(pathname, ALWAYS_PUBLIC_PREFIXES)) {
    return NextResponse.next()
  }

  // ตรวจแบบ optimistic จาก cookie เท่านั้น — หน้าและ Server Action ตรวจ session จริงซ้ำเสมอ
  const hasSession = Boolean(getSessionCookie(request))

  if (matches(pathname, AUTH_PAGE_PREFIXES)) {
    if (hasSession) {
      return NextResponse.redirect(new URL("/", request.url))
    }
    return NextResponse.next()
  }

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
