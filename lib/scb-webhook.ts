import "server-only"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forStore } from "@/lib/db"
import { findIntentByRef1 } from "@/lib/payment-intent"
import { verifyAndSettleIntent } from "@/lib/payment-reconcile"
import { confirmationResponse, inquireBillPayment } from "@/lib/payment-provider/scb"
import { getStoreScb } from "@/lib/scb-store"
import { findStoreByScbTestRef1 } from "@/lib/store-resolve"
import { scbPaymentConfirmationSchema } from "@/lib/validation"

/// ตัวจัดการ payment confirmation ของ SCB ที่ใช้ร่วมกัน 2 ปลายทาง (Phase 15c):
///   · /api/payments/webhook/scb/[secret]         — ของแพลตฟอร์ม (Phase 10) รับได้ทุกร้าน (ร้าน default ที่ใช้ env)
///   · /api/payments/webhook/scb/store/[token]    — ต่อร้าน: token ชี้ร้าน และ **intent ต้องเป็นของร้านนั้นเท่านั้น**
///     (webhook ร้าน A ปิดบิลร้าน B ไม่ได้ — เทสบังคับ)
/// ทั้งสองทางผ่านด่านเดียวกัน: กัน callback ซ้ำ → หา intent จาก ref1 → verifyAndSettleIntent (ถามธนาคารด้วย credential
/// ของร้านเจ้าของ intent → เทียบยอด → ปิดบิล) · เพิ่มเส้นทาง "ทดสอบการเชื่อมต่อ": ref1 ที่ตรง scbTestRef1 ของร้าน
/// = QR 1 บาทจากปุ่มทดสอบ → ถามธนาคารด้วย credential ของร้าน (ยังไม่ verified) → ผ่าน = ประทับ scbVerifiedAt
///
/// ⚠️ ห้าม log ค่า secret/token ที่รับเข้ามา และห้าม log payload ทั้งก้อน (มีชื่อ/เลขบัญชีผู้จ่าย)

export type ScbWebhookScope = { kind: "platform" } | { kind: "store"; storeId: string }

function log(message: string, detail?: Record<string, unknown>) {
  console.info(`[scb-webhook] ${message}`, detail ? JSON.stringify(detail) : "")
}

/// รูปแบบที่ตอบเมื่อ "ยังปิดบิลให้ไม่ได้" — resCode ไม่ใช่ 00 ธนาคารจะยิงซ้ำตามรอบของมัน
export function failureResponse(reason: string) {
  log("ปฏิเสธ ตอบ resCode 99", { reason })
  return NextResponse.json({ resCode: "99", resDesc: reason }, { status: 200 })
}

/// ธนาคารบังคับให้ inquiry ระบุ transactionDate เป็น yyyy-MM-dd ตามโซนเวลาไทย
/// callback ส่ง transactionDateandTime มาในรูป yyyy-MM-ddThh:mm:ss.sss±hh:mm อยู่แล้ว
/// ถ้าไม่มีค่ามาให้ ค่อยถอยไปใช้วันที่ปัจจุบันฝั่งไทย (อย่าใช้เวลาเครื่อง server ตรง ๆ)
export function toBangkokDate(raw?: string): string {
  if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" })
}

export async function handleScbConfirmation(body: unknown, scope: ScbWebhookScope) {
  const parsed = scbPaymentConfirmationSchema.safeParse(body)
  if (!parsed.success) {
    // log เฉพาะ "ชื่อฟิลด์ที่ส่งมา" ไม่ใช่ค่า — พอให้รู้ว่าธนาคารส่งโครงสร้างแบบไหนมาโดยไม่แตะข้อมูลผู้จ่าย
    log("payload ไม่ผ่าน schema", {
      keys: body && typeof body === "object" ? Object.keys(body) : typeof body,
      issue: parsed.error.issues[0]?.message ?? "-",
    })
    return failureResponse(parsed.error.issues[0]?.message ?? "payload ไม่ถูกต้อง")
  }

  // ตั้งใจไม่ดึง `amount` ออกมาใช้ — ยอดที่เอาไปตัดสินใจจริงต้องเป็นยอดที่ธนาคารยืนยันกลับมาเท่านั้น
  const { transactionId, billPaymentRef1, transactionDateandTime } = parsed.data
  log("payload ผ่านการตรวจแล้ว", { transactionId, billPaymentRef1, transactionDateandTime, scope: scope.kind })

  // ★ กัน callback ซ้ำก่อนทุกอย่าง — ธนาคารยิงซ้ำ *หลัง* บิลถูกปิดไปแล้วได้
  const settled = await prisma.sale.findUnique({ where: { paymentReference: transactionId }, select: { saleNumber: true } })
  if (settled) {
    log("callback ซ้ำ — บิลนี้ปิดไปแล้ว ตอบสำเร็จซ้ำ", { saleNumber: settled.saleNumber })
    return NextResponse.json(confirmationResponse(transactionId, settled.saleNumber))
  }

  // ── เส้นทางทดสอบการเชื่อมต่อ (Phase 15c) — QR 1 บาทจากปุ่มทดสอบ ไม่มี intent/โต๊ะ ──
  const testStore = await findStoreByScbTestRef1(billPaymentRef1)
  if (testStore) {
    if (scope.kind === "store" && scope.storeId !== testStore.storeId) {
      return failureResponse("เลขอ้างอิงทดสอบไม่ใช่ของร้านนี้")
    }
    return settleConnectionTest(testStore.storeId, billPaymentRef1, transactionId, toBangkokDate(transactionDateandTime))
  }

  const intent = await findIntentByRef1(billPaymentRef1)
  if (!intent) return failureResponse("ไม่พบรายการที่ตรงกับเลขอ้างอิงนี้")

  // ★ ต่อร้าน: intent ต้องเป็นของร้านเจ้าของ token — กัน callback (หรือคนที่รู้ token ร้าน A) ปิดบิลของร้านอื่น
  if (scope.kind === "store" && intent.storeId !== scope.storeId) {
    log("intent เป็นของร้านอื่น — ปฏิเสธ", { ref1: billPaymentRef1 })
    return failureResponse("เลขอ้างอิงนี้ไม่ใช่ของร้านนี้")
  }

  // ★ ด่านตรวจทั้งหมด (ถามธนาคาร → เทียบยอด → ปิดบิล) อยู่ใน verifyAndSettleIntent
  //   เส้นทางนี้เป็น **ทางเดียวที่ปิดบิลอัตโนมัติผ่าน SCB ได้** ตามการตัดสินใจ 2026-09-09
  const outcome = await verifyAndSettleIntent(intent, toBangkokDate(transactionDateandTime))
  if (!outcome.ok) return failureResponse(outcome.reason)

  return NextResponse.json(confirmationResponse(outcome.transactionId, outcome.saleNumber))
}

/// ยืนยันการทดสอบ: ถามธนาคารด้วย credential **ของร้าน** (ยังไม่ verified) ว่ารายการ 1 บาทเข้าจริง → ประทับ scbVerifiedAt
/// updateMany where scbTestRef1 = ref1 → callback ซ้ำครั้งที่สอง count 0 แต่ยังตอบสำเร็จ (ผ่านไปแล้ว)
async function settleConnectionTest(storeId: string, ref1: string, transactionId: string, transactionDate: string) {
  const scb = await getStoreScb(storeId, { allowUnverified: true })
  if (!scb || scb.source !== "store") return failureResponse("ร้านนี้ไม่มี credential SCB ของตัวเองให้ทดสอบ")

  const verified = await inquireBillPayment(scb.creds, { transactionDate, ref1 })
  if (!verified.ok) {
    log("ทดสอบการเชื่อมต่อ: ธนาคารไม่ยืนยันรายการ", { ref1, error: verified.error })
    return failureResponse(verified.error)
  }
  if (verified.data.amount < 1) return failureResponse("ยอดทดสอบต้องอย่างน้อย 1 บาท")

  const now = new Date()
  const stamped = await forStore(storeId).storePaymentConfig.updateMany({
    where: { storeId, scbTestRef1: ref1 },
    data: { scbVerifiedAt: now, scbTestRef1: null, scbTestStartedAt: null },
  })
  log("ทดสอบการเชื่อมต่อผ่าน — เปิดปิดบิลอัตโนมัติด้วย credential ของร้าน", { storeId, transactionId, alreadyStamped: stamped.count === 0 })
  return NextResponse.json(confirmationResponse(transactionId, "SCB-TEST"))
}
