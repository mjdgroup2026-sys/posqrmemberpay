import { NextResponse, type NextRequest } from "next/server"
import { findStoreByScbWebhookToken } from "@/lib/store-resolve"
import { handleScbConfirmation } from "@/lib/scb-webhook"

/// ปลายทาง payment confirmation ของ SCB **ต่อร้าน** (Phase 15c) — ร้านที่ผูก SCB เองลงทะเบียน URL นี้ในพอร์ทัล SCB
///
///   https://<โดเมน>/api/payments/webhook/scb/store/<StorePaymentConfig.scbWebhookToken>
///
/// token สุ่ม 32 ไบต์ตอนร้านบันทึก credential ครั้งแรก · หาร้านจาก token (unique) แล้วส่งต่อให้ lib/scb-webhook.ts
/// ซึ่งบังคับว่า **intent ต้องเป็นของร้านนี้** — callback (หรือใครที่รู้ token ของร้าน A) ปิดบิลร้าน B ไม่ได้
/// การตรวจกับธนาคารใช้ credential ของร้านเจ้าของ intent (lib/payment-reconcile.ts → getStoreScb)
function log(message: string, detail?: Record<string, unknown>) {
  console.info(`[scb-webhook] ${message}`, detail ? JSON.stringify(detail) : "")
}

export async function POST(request: NextRequest, context: RouteContext<"/api/payments/webhook/scb/store/[token]">) {
  log("มีคำขอเข้ามา (ต่อร้าน)", {
    userAgent: request.headers.get("user-agent") ?? "-",
    contentLength: request.headers.get("content-length") ?? "-",
  })

  const { token } = await context.params
  const store = await findStoreByScbWebhookToken(token)
  if (!store) {
    // ห้าม log token — log แค่ความยาว
    log("ตอบ 401 — ไม่พบร้านของ token นี้", { receivedLength: token.length })
    return NextResponse.json({ resCode: "99", resDesc: "unauthorized" }, { status: 401 })
  }
  if (store.status === "SUSPENDED") {
    log("ร้านถูกระงับ — ปฏิเสธ", { slug: store.slug })
    return NextResponse.json({ resCode: "99", resDesc: "ร้านถูกระงับการใช้งาน" }, { status: 200 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ resCode: "99", resDesc: "payload ไม่ใช่ JSON" }, { status: 200 })
  }

  return handleScbConfirmation(body, { kind: "store", storeId: store.storeId })
}
