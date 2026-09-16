import "server-only"
import { forStore } from "@/lib/db"
import { closeSessionWithPayment, computeBillTotals } from "@/lib/close-session"
import { toNumber } from "@/lib/format"
import { getStorePaymentProfile } from "@/lib/payment-methods"
import { slipMaxAgeMinutes, verifySlip, type VerifiedSlip } from "@/lib/slip-provider"
import { maskedAccountMatches, parseSlipQr } from "@/lib/slip-qr"

/// ตรวจสลิปแล้วปิดบิล (Phase 15b — โหมด ก+) · เส้นทางอัตโนมัติที่ 2 ถัดจาก callback ของ SCB
///
/// ต่างจาก SCB ตรงที่ "ต้นทาง" คือลูกค้าเอง (แนบสลิป) ไม่ใช่ธนาคาร — จึงเชื่ออะไรจากฝั่งลูกค้าไม่ได้เลย นอกจากคำตอบ
/// ของผู้ให้บริการตรวจสลิป · ด่านตรวจ 4 ชั้นตาม spec ห้ามข้าม:
///   ① ผู้รับตรงบัญชีร้าน (StorePaymentConfig — เทียบแบบปิดบางหลัก)   ② ยอด ≥ บิลปัจจุบัน (ตรวจซ้ำใน closeSessionWithPayment
///   ผ่าน verifiedAmount กันคนบนโต๊ะสั่งเพิ่มระหว่างจ่าย)   ③ สลิปไม่เคยใช้ (Sale.paymentReference = "SLIP:<transRef>" unique
///   และห้ามใช้สลิปเดิมกับโต๊ะอื่น)   ④ สลิปไม่เก่ากว่า SLIP_MAX_AGE_MINUTES
/// · ผู้ให้บริการล่ม → ไม่ปิดบิล บอกลูกค้าให้แจ้งพนักงาน (โหมด ก) · ยอดขาด → แจ้งพนักงาน (Notification CHECK_BILL) ไม่ปิดบิล

export type SlipSettleResult =
  | { ok: true; saleNumber: string; alreadyClosed: boolean }
  | { ok: false; reason: string; code: "MODE" | "INVALID" | "RECEIVER" | "AMOUNT" | "DUPLICATE" | "EXPIRED" | "PROVIDER_DOWN" | "CLOSE_FAILED" }

export function slipPaymentReference(transRef: string): string {
  return `SLIP:${transRef}`
}

function log(message: string, detail?: Record<string, unknown>) {
  console.info(`[slip-settle] ${message}`, detail ? JSON.stringify(detail) : "")
}

/// ผู้รับในสลิปคือบัญชีของร้านนี้จริงไหม — ผ่านคู่ใดคู่หนึ่ง: proxy ↔ พร้อมเพย์ร้าน · account ↔ เลขบัญชีร้าน
/// (mock คืนเลขเต็ม · เจ้าจริงคืนแบบปิดบางหลัก ทั้งสองแบบผ่าน maskedAccountMatches ได้)
export function receiverMatchesStore(
  receiver: VerifiedSlip["receiver"],
  config: { promptPayId: string | null; bankAccountNumber: string | null },
): boolean {
  return (
    maskedAccountMatches(receiver.proxy, config.promptPayId) ||
    maskedAccountMatches(receiver.account, config.bankAccountNumber) ||
    // บางเจ้าใส่เลขพร้อมเพย์ไว้ในช่อง account แทน proxy
    maskedAccountMatches(receiver.account, config.promptPayId) ||
    maskedAccountMatches(receiver.proxy, config.bankAccountNumber)
  )
}

export async function verifySlipAndSettle(input: { storeId: string; sessionId: string; payload: string }): Promise<SlipSettleResult> {
  const { storeId, sessionId } = input
  const payload = input.payload.trim()
  const db = forStore(storeId)

  const profile = await getStorePaymentProfile(storeId)
  if (!profile.slipVerification) {
    return { ok: false, code: "MODE", reason: "ร้านนี้ไม่ได้เปิดรับสลิปอัตโนมัติ กรุณาแจ้งพนักงานให้ยืนยันการชำระเงิน" }
  }

  const parsed = parseSlipQr(payload)
  if (!parsed) return { ok: false, code: "INVALID", reason: "อ่าน QR บนสลิปไม่ได้ กรุณาถ่ายสลิปให้ชัดหรือแจ้งพนักงาน" }

  // ③ (ก่อนเสียโควตา) — สลิปนี้เคยปิดบิลไปแล้วไหม
  const reference = slipPaymentReference(parsed.transRef)
  const used = await db.sale.findUnique({ where: { paymentReference: reference }, select: { saleNumber: true, tableSessionId: true } })
  if (used) {
    if (used.tableSessionId === sessionId) return { ok: true, saleNumber: used.saleNumber, alreadyClosed: true }
    log("สลิปซ้ำ — เคยใช้ปิดบิลโต๊ะอื่นแล้ว", { transRef: parsed.transRef, saleNumber: used.saleNumber })
    return { ok: false, code: "DUPLICATE", reason: "สลิปนี้ถูกใช้ชำระบิลอื่นไปแล้ว กรุณาแจ้งพนักงาน" }
  }

  const verified = await verifySlip(payload)
  if (!verified.ok) {
    if (verified.code === "PROVIDER_DOWN" || verified.code === "NOT_CONFIGURED") {
      log("ผู้ให้บริการตรวจสลิปไม่ตอบ — ถอยไปให้พนักงานปิดมือ", { code: verified.code })
      return { ok: false, code: "PROVIDER_DOWN", reason: "ตรวจสลิปอัตโนมัติไม่ได้ในขณะนี้ กรุณาแจ้งพนักงานให้ยืนยันการชำระเงิน" }
    }
    if (verified.code === "DUPLICATE") return { ok: false, code: "DUPLICATE", reason: verified.error }
    return { ok: false, code: "INVALID", reason: verified.error }
  }
  const slip = verified.data

  // ① ผู้รับต้องเป็นร้านนี้ — ไม่งั้นลูกค้าเอาสลิปโอนเข้าบัญชีใครก็ได้มาปิดบิล
  const config = await db.storePaymentConfig.findUnique({ where: { storeId }, select: { promptPayId: true, bankAccountNumber: true } })
  if (!config || !receiverMatchesStore(slip.receiver, config)) {
    log("ผู้รับในสลิปไม่ใช่บัญชีร้าน", { transRef: slip.transRef, receiver: slip.receiver })
    return { ok: false, code: "RECEIVER", reason: "สลิปนี้ไม่ได้โอนเข้าบัญชีของร้าน กรุณาตรวจสอบหรือแจ้งพนักงาน" }
  }

  // ④ สลิปเก่า — กันเอาสลิปเดิมของวันก่อน (ที่ยังไม่เคยใช้ในระบบ) มาปิดบิล
  const ageMinutes = (Date.now() - slip.transferredAt.getTime()) / 60_000
  if (ageMinutes > slipMaxAgeMinutes()) {
    log("สลิปเก่าเกินกำหนด", { transRef: slip.transRef, ageMinutes: Math.round(ageMinutes) })
    return { ok: false, code: "EXPIRED", reason: `สลิปนี้โอนเกิน ${slipMaxAgeMinutes()} นาทีแล้ว กรุณาแจ้งพนักงานให้ตรวจสอบ` }
  }

  // ② ยอด ≥ บิลปัจจุบัน — เช็คก่อนเพื่อแจ้งพนักงานพร้อมตัวเลข · closeSessionWithPayment เช็คซ้ำในทรานแซคชันอีกชั้น
  const session = await db.tableSession.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      orders: { select: { items: { where: { status: { not: "CANCELLED" } }, select: { quantity: true, unitPrice: true } } } },
    },
  })
  if (!session) return { ok: false, code: "CLOSE_FAILED", reason: "ไม่พบโต๊ะที่ต้องการชำระ กรุณาแจ้งพนักงาน" }
  const settings = await db.storeSettings.findUnique({ where: { storeId }, select: { serviceChargePercent: true } })
  const lines = session.orders.flatMap((o) => o.items.map((i) => ({ quantity: i.quantity, unitPrice: toNumber(i.unitPrice) })))
  const totals = computeBillTotals(lines, toNumber(settings?.serviceChargePercent ?? 0))

  if (slip.amount + 0.005 < totals.total) {
    log("ยอดในสลิปน้อยกว่าบิล — ส่งให้พนักงาน", { transRef: slip.transRef, slipAmount: slip.amount, billTotal: totals.total })
    await db.notification.create({
      data: {
        storeId,
        tableSessionId: sessionId,
        type: "CHECK_BILL",
        reason:
          `ลูกค้าแนบสลิป ${slip.amount.toFixed(2)} บาท แต่บิลคือ ${totals.total.toFixed(2)} บาท ` +
          `(อ้างอิง ${slip.transRef}) — ยอดไม่พอ กรุณาตรวจสอบก่อนปิดโต๊ะ`,
      },
    })
    return {
      ok: false,
      code: "AMOUNT",
      reason: `ยอดในสลิป ${slip.amount.toFixed(2)} บาท น้อยกว่าบิล ${totals.total.toFixed(2)} บาท — แจ้งพนักงานแล้ว กรุณารอพนักงานตรวจสอบ`,
    }
  }

  const closed = await closeSessionWithPayment({
    storeId,
    sessionId,
    paymentMethod: "PROMPTPAY",
    paymentReference: reference,
    amountReceived: slip.amount,
    verifiedAmount: slip.amount,
    note: `ตรวจสลิปอัตโนมัติ (${slip.provider}) · ผู้โอน ${slip.sender.name ?? "-"}`,
  })
  if (!closed.ok) {
    log("สลิปผ่านแต่ปิดบิลไม่ได้", { transRef: slip.transRef, reason: closed.error })
    await db.notification.create({
      data: {
        storeId,
        tableSessionId: sessionId,
        type: "CHECK_BILL",
        reason: `สลิป ${slip.amount.toFixed(2)} บาท (อ้างอิง ${slip.transRef}) ผ่านการตรวจแล้ว แต่ระบบปิดบิลไม่ได้: ${closed.error} — กรุณาปิดบิลด้วยตนเอง`,
      },
    })
    return { ok: false, code: "CLOSE_FAILED", reason: `${closed.error} — แจ้งพนักงานแล้ว` }
  }

  log("ปิดบิลจากสลิปสำเร็จ", { saleNumber: closed.saleNumber, transRef: slip.transRef, amount: slip.amount, provider: slip.provider })
  return { ok: true, saleNumber: closed.saleNumber, alreadyClosed: closed.alreadyClosed }
}
