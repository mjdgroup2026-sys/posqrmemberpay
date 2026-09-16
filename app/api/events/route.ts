import { NextResponse, type NextRequest } from "next/server"
import { resolveStoreContext } from "@/lib/session"
import { sseResponse } from "@/lib/realtime"

/// SSE ฝั่งพนักงาน — stream สัญญาณ "อะไรเปลี่ยน" ของร้านที่ทำงานอยู่ (ผังโต๊ะ/KDS/แจ้งเตือน/รายละเอียดโต๊ะ)
///
/// ตรวจสิทธิ์เหมือนหน้าเว็บ: ต้องล็อกอินและอยู่ในร้าน (cookie ร้านที่ทำงานอยู่) — ช่องผูกกับ storeId ของ context จึงไม่มี
/// ทางสมัครฟังร้านอื่น · event ไม่พกข้อมูล client ไป router.refresh() เอง ซึ่งผ่านด่านสิทธิ์ของหน้าอีกชั้นอยู่แล้ว
/// · ต้อง dynamic เสมอ (ห้าม cache/prerender)
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const result = await resolveStoreContext()
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: result.reason === "UNAUTHENTICATED" ? 401 : 403 })
  }
  return sseResponse(result.context.storeId, request.signal)
}
