import "server-only"
import { forStore } from "@/lib/db"
import { closeSessionWithPayment } from "@/lib/close-session"
import { markIntentFailed, markIntentPaid, type IntentLookup } from "@/lib/payment-intent"
import { inquireBillPayment } from "@/lib/payment-provider/scb"
import { getStoreScb } from "@/lib/scb-store"

/// ตรวจกับธนาคารแล้วปิดบิล — เรียกจาก callback ของ SCB เท่านั้น
///
/// ⚠️ **callback คือทางเดียวที่ปิดบิลอัตโนมัติได้** (ตัดสินใจไว้ 2026-09-09 หลัง SCB แก้ปลายทาง
/// ให้แล้ว) · เคยมีเส้นทาง "โพลถามธนาคารเอง" ที่ปิดบิลได้โดยไม่ต้องรอ callback แล้วถอดออก —
/// เจ้าของระบบเลือกให้เงินเข้าถูกยืนยันด้วย callback ของธนาคารเท่านั้น ไม่ให้แอปตัดสินใจเอง
///
/// ผลที่ตามมาที่ต้องยอมรับ: **callback หายเมื่อไหร่ บิลค้างทันทีทุกใบ** และต้องให้พนักงานปิดมือ
/// ที่ `/mobile-order/tables/[tableId]/billing` · เคยเกิดจริงมาแล้ว 2026-09-08 ถึง 09-09
/// (จ่ายสำเร็จหลายรอบ ไม่มีบิลปิดสักใบ เพราะปลายทางในพอร์ทัล SCB ยังตั้งไม่ถูก) —
/// ถ้าอาการนั้นกลับมา ให้ดู log `[scb-webhook]` ก่อนเสมอว่าธนาคารยิงมาถึงหรือไม่
///
/// ด่านตรวจ 3 ชั้นที่ห้ามข้าม: ①ธนาคารยืนยันว่ารายการมีจริง ②ยอดตรงกับที่ล็อกไว้ตอนออก QR
/// ③ยอดยังพอกับบิลปัจจุบัน (ตรวจใน closeSessionWithPayment ผ่าน verifiedAmount)

export type SettleResult =
  | { ok: true; saleNumber: string; transactionId: string }
  | { ok: false; reason: string }

function log(message: string, detail?: Record<string, unknown>) {
  console.info(`[scb-settle] ${message}`, detail ? JSON.stringify(detail) : "")
}

/// ยกเคสให้พนักงานตัดสิน แล้วหยุดพยายามปิดบิลเอง
///
/// สร้าง Notification เฉพาะ "ครั้งที่ปิดใบได้จริง" เท่านั้น — เคสเดียวกันถูกตรวจเจอซ้ำได้หลายรอบ
/// เพราะธนาคาร retry callback 3 ครั้ง ห่างกัน 12 วินาที ถ้าแจ้งทุกรอบพนักงานจะได้ใบซ้ำสามใบ
async function handOffToStaff(intent: IntentLookup, reason: string): Promise<void> {
  if (!(await markIntentFailed(intent.storeId, intent.id))) return
  await forStore(intent.storeId).notification.create({
    data: { storeId: intent.storeId, tableSessionId: intent.tableSessionId, type: "CHECK_BILL", reason },
  })
}

/// ถามธนาคาร → เทียบยอด → ปิดบิล · ใช้กับ intent ที่รู้แล้วว่าเป็นของโต๊ะไหน
export async function verifyAndSettleIntent(
  intent: IntentLookup,
  transactionDate: string,
): Promise<SettleResult> {
  // credential ของร้านเจ้าของ intent (Phase 15c) — ร้านผูกเองที่ผ่านการทดสอบแล้ว หรือ env ของแพลตฟอร์ม (fallback)
  const scb = await getStoreScb(intent.storeId)
  if (!scb) return { ok: false, reason: "ร้านนี้ไม่มี credential SCB สำหรับตรวจสอบรายการ" }

  // ★ ด่านที่ 1 — ถามธนาคารว่ารายการนี้เกิดขึ้นจริงไหม ห้ามเชื่อ payload ที่ยิงเข้ามา
  //   (callback ของ SCB ไม่มีลายเซ็นหรือ credential ใด ๆ ใครเดา URL ถูกก็ยิงปลอมได้)
  const verified = await inquireBillPayment(scb.creds, { transactionDate, ref1: intent.ref1 })
  if (!verified.ok) {
    // ยังไม่ mark FAILED — อาจเป็นแค่ธนาคารตอบช้า/เน็ตสะดุด ปล่อยให้ retry รอบหน้าลองใหม่ได้
    return { ok: false, reason: verified.error }
  }

  const bank = verified.data

  // ★ ด่านที่ 2 — ลูกค้าแก้จำนวนเงินในแอปธนาคารได้ ปิดบิลทั้งที่ได้เงินไม่ครบไม่ได้
  if (bank.amount !== intent.amount) {
    log("ยอดไม่ตรงกับที่ล็อกไว้ตอนออก QR", { bankAmount: bank.amount, intentAmount: intent.amount })
    await handOffToStaff(
      intent,
      `ยอดชำระไม่ตรงกับบิล — ธนาคารยืนยัน ${bank.amount.toFixed(2)} บาท ` +
        `แต่บิลคือ ${intent.amount.toFixed(2)} บาท กรุณาตรวจสอบก่อนปิดโต๊ะ`,
    )
    return { ok: false, reason: "ยอดชำระไม่ตรงกับบิล ส่งให้พนักงานตรวจสอบแล้ว" }
  }

  // ★ ด่านที่ 3 อยู่ข้างใน closeSessionWithPayment — `verifiedAmount` ทำให้มันยกเลิกทรานแซคชัน
  //   ถ้าบิลโตขึ้นระหว่างที่ลูกค้ากำลังจ่าย (คนอื่นบนโต๊ะเดียวกันสั่งเพิ่ม)
  const closed = await closeSessionWithPayment({
    storeId: intent.storeId,
    sessionId: intent.tableSessionId,
    paymentMethod: "PROMPTPAY",
    paymentReference: bank.transactionId,
    amountReceived: bank.amount,
    verifiedAmount: bank.amount,
  })

  if (!closed.ok) {
    // เงินเข้าธนาคารแล้วแต่ปิดบิลไม่ได้ — ห้ามปล่อยเงียบ ไม่งั้นลูกค้าจ่ายไปแล้วแต่โต๊ะยังค้าง
    // แล้วไม่มีใครรู้เลยว่ามีเงินก้อนนี้อยู่ · ส่งต่อให้พนักงานตรวจแล้วหยุดลองใหม่
    log("ธนาคารยืนยันเงินเข้าแล้วแต่ปิดบิลไม่ได้", { reason: closed.error, transactionId: bank.transactionId })
    await handOffToStaff(
      intent,
      `ได้รับเงิน ${bank.amount.toFixed(2)} บาทแล้ว (อ้างอิง ${bank.transactionId}) ` +
        `แต่ระบบปิดบิลอัตโนมัติไม่ได้: ${closed.error} — กรุณาตรวจสอบแล้วปิดบิลด้วยตนเอง`,
    )
    return { ok: false, reason: closed.error }
  }

  await markIntentPaid(intent.storeId, intent.id, bank.transactionId)

  log("ปิดบิลสำเร็จ", {
    saleNumber: closed.saleNumber,
    transactionId: bank.transactionId,
    amount: bank.amount,
    alreadyClosed: closed.alreadyClosed,
  })

  return { ok: true, saleNumber: closed.saleNumber, transactionId: bank.transactionId }
}
