import { NextResponse, type NextRequest } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { closeSessionWithPayment } from "@/lib/close-session"
import { paymentWebhookSchema } from "@/lib/validation"

/// Webhook ยืนยันการชำระเงิน PromptPay จากผู้ให้บริการ (ธนาคาร/payment aggregator)
///
/// ออกแบบให้เป็นกลาง ไม่ผูกกับ provider รายใด — provider ส่ง POST JSON มาที่
///   POST /api/payments/webhook
///   header: x-webhook-secret: <PAYMENT_WEBHOOK_SECRET>
///   body: { "reference": "<เลขอ้างอิงที่ไม่ซ้ำ>", "sessionId": "…" | "qrToken": "…", "amount": 350.00 }
///
/// ถ้า provider จริงส่งรูปแบบอื่น ให้เขียน adapter แปลงเป็นรูปนี้ตรงจุดเดียวในไฟล์นี้
///
/// ⚠️ กติกา: idempotent เสมอ — ยิงซ้ำด้วย reference เดิมต้องได้ผลเดิมและ **ต้องไม่สร้างบิลซ้ำ**
///    (บังคับด้วย unique `Sale.paymentReference` ไม่ใช่แค่เช็คในโค้ด)

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  const expected = process.env.PAYMENT_WEBHOOK_SECRET
  if (!expected) {
    // ไม่ตั้ง secret = ยังไม่เปิดใช้งานเส้นทางอัตโนมัติ — ปฏิเสธไว้ก่อน ดีกว่าเปิดรับใครก็ได้
    return NextResponse.json({ ok: false, error: "webhook ยังไม่ถูกเปิดใช้งาน" }, { status: 503 })
  }
  if (!secretMatches(request.headers.get("x-webhook-secret"), expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "payload ไม่ใช่ JSON" }, { status: 400 })
  }

  const parsed = paymentWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "payload ไม่ถูกต้อง" },
      { status: 400 },
    )
  }

  const { reference, sessionId, qrToken, amount } = parsed.data

  // ★ ตรวจ reference ก่อนทุกอย่าง — ธนาคารยิงซ้ำ *หลัง* บิลถูกปิดไปแล้ว ซึ่งตอนนั้นไม่มี session
  //   ที่ OPEN/AWAITING_BILL ให้หาเจออีก ถ้าไปหา session ก่อนจะได้ 404 แล้วธนาคาร retry ไม่รู้จบ
  const settled = await prisma.sale.findUnique({
    where: { paymentReference: reference },
    select: { saleNumber: true },
  })
  if (settled) {
    return NextResponse.json({ ok: true, saleNumber: settled.saleNumber, duplicated: true })
  }

  // ร้านของการชำระเงินนี้ (Phase 13): จาก qrToken หรือจาก session ที่ระบุมา — ค้นข้ามร้านได้เพราะ
  // callback ไม่มี session/cookie · หลังจากนี้ปิดบิลใต้ร้านนั้นเท่านั้น
  let targetSessionId = sessionId
  let storeId: string | undefined
  if (targetSessionId) {
    const session = await prisma.tableSession.findUnique({
      where: { id: targetSessionId },
      select: { storeId: true },
    })
    storeId = session?.storeId
  } else if (qrToken) {
    const qr = await prisma.qRCode.findUnique({
      where: { token: qrToken },
      select: { storeId: true, tableId: true, table: { select: { primaryTableId: true } } },
    })
    if (qr) {
      const tableId = qr.table.primaryTableId ?? qr.tableId
      const session = await prisma.tableSession.findFirst({
        where: { storeId: qr.storeId, tableId, status: { in: ["OPEN", "AWAITING_BILL"] } },
        orderBy: { openedAt: "desc" },
        select: { id: true },
      })
      targetSessionId = session?.id
      storeId = qr.storeId
    }
  }

  if (!targetSessionId || !storeId) {
    return NextResponse.json({ ok: false, error: "ไม่พบโต๊ะที่ตรงกับการชำระเงินนี้" }, { status: 404 })
  }

  const result = await closeSessionWithPayment({
    storeId,
    sessionId: targetSessionId,
    paymentMethod: "PROMPTPAY",
    paymentReference: reference,
    amountReceived: amount,
  })

  if (!result.ok) {
    // ตอบ 409 เพื่อให้ provider รู้ว่าไม่ควร retry ซ้ำแบบเดิม (คนละกรณีกับ 5xx)
    return NextResponse.json({ ok: false, error: result.error }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    saleNumber: result.saleNumber,
    duplicated: result.alreadyClosed,
  })
}
