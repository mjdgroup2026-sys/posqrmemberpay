import { NextResponse } from "next/server"
import { resolveCustomerSession, getCustomerOrderView } from "@/lib/queries"

/// สถานะออร์เดอร์สำหรับหน้าลูกค้า — โพลทุก 4 วินาที (ฝั่งลูกค้าไม่ใช้ WebSocket ตาม §6a)
/// เป็น endpoint สาธารณะที่ยึด qrToken เป็นตัวระบุตัวตน จึงตอบเฉพาะข้อมูลของโต๊ะนั้นเท่านั้น
export async function GET(_request: Request, context: RouteContext<"/api/order/[qrToken]/status">) {
  const { qrToken } = await context.params

  const session = await resolveCustomerSession(qrToken)
  if (!session.ok) {
    return NextResponse.json({ ok: false, reason: session.reason }, { status: 404 })
  }

  const view = await getCustomerOrderView(session.storeId, session.sessionId)
  if (!view) {
    return NextResponse.json({ ok: false, reason: "NO_SESSION" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, view })
}
