import { NextResponse, type NextRequest } from "next/server"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { sseResponse } from "@/lib/realtime"

/// SSE ฝั่งลูกค้า — สัญญาณว่าออร์เดอร์/การชำระเงินของร้านเปลี่ยน ให้หน้า สถานะ/ชำระเงิน ดึงข้อมูลใหม่ทันทีแทนรอโพล
///
/// ยึด qrToken เป็นตัวระบุตัวตนเหมือน endpoint ลูกค้าอื่น · ช่องคือร้านเจ้าของ QR — event ไม่พกข้อมูล (แค่ topic)
/// ลูกค้าจึงรู้แค่ว่า "มีอะไรเปลี่ยนในร้าน" แล้วไป fetch สถานะของโต๊ะตัวเองผ่าน /status /payment ซึ่งกรองด้วย qrToken อยู่แล้ว
/// · ต่อได้แม้ QR ถูก invalidate ไปแล้ว (หน้า pay ต้องเห็น "จ่ายสำเร็จ" หลังปิดบิล ซึ่งเป็นตอนที่ DYNAMIC QR ใช้ไม่ได้พอดี)
export const dynamic = "force-dynamic"

const CUSTOMER_TOPICS = new Set(["orders", "payments", "tables"])

export async function GET(request: NextRequest, context: RouteContext<"/api/order/[qrToken]/events">) {
  const { qrToken } = await context.params
  const store = await findStoreByQrToken(qrToken)
  if (!store) return NextResponse.json({ ok: false, reason: "QR_NOT_FOUND" }, { status: 404 })
  return sseResponse(store.storeId, request.signal, (topic) => CUSTOMER_TOPICS.has(topic))
}
