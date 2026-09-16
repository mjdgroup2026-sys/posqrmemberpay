import { NextResponse, type NextRequest } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { handleScbConfirmation } from "@/lib/scb-webhook"

/// ปลายทาง payment confirmation ของ SCB **ระดับแพลตฟอร์ม** (Phase 10) — ร้าน default ที่ใช้ env SCB_* ลงทะเบียน URL นี้ไว้
///
///   https://<โดเมน>/api/payments/webhook/scb/<SCB_WEBHOOK_SECRET>
///
/// Phase 15c เพิ่มปลายทางต่อร้าน /api/payments/webhook/scb/store/<token> — ตรรกะทั้งหมดอยู่ที่ lib/scb-webhook.ts ใช้ร่วมกัน
/// URL นี้ยังทำงานคู่กันจนกว่าร้าน default จะย้าย credential เข้าฐานและสลับปลายทางในพอร์ทัล SCB เสร็จ
///
/// ⚠️ **SCB ไม่แนบ signature, API key หรือ credential ใด ๆ มากับ callback เลย** (ยืนยันจากเอกสาร
/// qr-payment/payment-confirmation) แปลว่าใครก็ตามที่เดา URL ถูกก็ POST ปลอมมาปิดบิลได้ฟรี
/// จึงกัน 3 ชั้น และ **ชั้นที่เชื่อถือได้จริงคือชั้นที่ 2** ไม่ใช่ชั้นแรก:
///   1. path ลับที่เดาไม่ได้ (กันคนยิงมั่ว ไม่ใช่กันคนที่รู้ URL)
///   2. ถามกลับไปที่ธนาคารว่ารายการนี้มีจริง (inquireBillPayment) ← ด่านจริง
///   3. เทียบยอดกับที่บันทึกไว้ตอนออก QR — ไม่ตรงห้ามปิดบิลเอง ให้พนักงานตรวจ
///
/// ต้องตอบกลับด้วยรูปแบบของ SCB เสมอ ({resCode:"00",...}) ตอบผิดรูป = ธนาคารถือว่าล้มเหลว
/// แล้วยิงซ้ำ 3 ครั้ง ห่างกัน 12 วินาที ก่อนเลิกแล้วส่งรายละเอียดไปทางอีเมลแทน
///
/// บันทึกทุกเส้นทางของ callback ลง log — เวลาบิลไม่ปิด คำถามแรกคือ "ธนาคารยิงมาถึงไหม" (ดู CLAUDE.md)
/// ⚠️ ห้าม log ค่า secret ที่รับเข้ามา และห้าม log payload ทั้งก้อน (มีชื่อและเลขบัญชีผู้จ่าย)
function log(message: string, detail?: Record<string, unknown>) {
  console.info(`[scb-webhook] ${message}`, detail ? JSON.stringify(detail) : "")
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: NextRequest, context: RouteContext<"/api/payments/webhook/scb/[secret]">) {
  // บรรทัดแรกสุด — มีคำขอเข้ามาถึงตัว route จริงหรือไม่ คือคำถามแรกที่ต้องตอบได้เสมอ
  log("มีคำขอเข้ามา", {
    userAgent: request.headers.get("user-agent") ?? "-",
    contentLength: request.headers.get("content-length") ?? "-",
  })

  const expected = process.env.SCB_WEBHOOK_SECRET
  if (!expected) {
    // ไม่ตั้ง secret = ยังไม่เปิดใช้เส้นทางอัตโนมัติ — ปฏิเสธไว้ก่อน ดีกว่าเปิดรับใครก็ได้
    log("ตอบ 503 — ยังไม่ได้ตั้ง SCB_WEBHOOK_SECRET")
    return NextResponse.json({ resCode: "99", resDesc: "webhook ยังไม่ถูกเปิดใช้งาน" }, { status: 503 })
  }

  const { secret } = await context.params
  if (!secretMatches(secret, expected)) {
    // ห้าม log ค่าที่รับมา — log แค่ความยาวไว้ไล่เคส URL ถูกตัดสั้นระหว่างทาง
    log("ตอบ 401 — secret ไม่ตรง", { receivedLength: secret.length, expectedLength: expected.length })
    return NextResponse.json({ resCode: "99", resDesc: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ resCode: "99", resDesc: "payload ไม่ใช่ JSON" }, { status: 200 })
  }

  return handleScbConfirmation(body, { kind: "platform" })
}
