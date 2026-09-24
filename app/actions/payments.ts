"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { publishStoreEvent } from "@/lib/realtime"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { slipPaymentReference, verifySlipAndSettle } from "@/lib/slip-settle"
import { parseSlipQr } from "@/lib/slip-qr"
import { closeSessionWithPayment, computeBillTotals } from "@/lib/close-session"
import { toNumber } from "@/lib/format"
import { hasMultipleOpenBills, SHARED_ROOM_PAYMENT_MESSAGE } from "@/lib/table-session"
import QRCode from "qrcode"
import { getStorePaymentProfile } from "@/lib/payment-methods"
import { getStoreScb } from "@/lib/scb-store"
import { issuePaymentIntent } from "@/lib/payment-intent"
import { createQrCode } from "@/lib/payment-provider/scb"
import { buildPromptPayPayload } from "@/lib/promptpay"
import {
  confirmPaymentSchema,
  startPaymentSchema,
  submitSlipSchema,
  firstIssueMessage,
  zodToFieldErrors,
} from "@/lib/validation"
import type { ActionResult } from "@/lib/types"


class PaymentAbort extends Error {
  constructor(readonly reason: string) {
    super("PAYMENT_ABORT")
  }
}

/// revalidate + ส่งสัญญาณ SSE (Phase 8 realtime) — เรียกหลังเขียน DB สำเร็จเท่านั้น
function revalidatePaymentPages(storeId: string) {
  publishStoreEvent(storeId, "payments")
  publishStoreEvent(storeId, "tables")
  publishStoreEvent(storeId, "notifications")
  revalidatePath("/")
  revalidatePath("/mobile-order/tables")
  revalidatePath("/mobile-order/kitchen")
  revalidatePath("/mobile-order/notifications")
  revalidatePath("/pos/history")
  revalidatePath("/pos/closing")
  revalidatePath("/reports")
}

/// พนักงานกดยืนยันรับชำระเงินที่เคาน์เตอร์ (Card/EDC, เงินสด, โอน หรือยืนยัน PromptPay ด้วยมือ)
///
/// ทางนี้เป็น "เส้นทางมือ" ที่ต้องมีเสมอ ไม่ว่าจะต่อ payment provider หรือยัง — ร้านต้องปิดบิลได้
/// แม้ webhook ไม่มา (เน็ตล่ม/provider ล่ม) ส่วนเส้นทางอัตโนมัติอยู่ที่ /api/payments/webhook
export async function confirmMobilePayment(formData: FormData): Promise<ActionResult<{ saleNumber: string }>> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_TABLES", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const user = ctx.user
  const storeId = ctx.storeId

  const parsed = confirmPaymentSchema.safeParse({
    sessionId: formData.get("sessionId") ?? "",
    paymentMethod: formData.get("paymentMethod") ?? "",
    amountReceived: formData.get("amountReceived") ?? undefined,
    reference: formData.get("reference") ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const result = await closeSessionWithPayment({
    storeId,
    sessionId: parsed.data.sessionId,
    paymentMethod: parsed.data.paymentMethod,
    cashierId: user.id,
    amountReceived: parsed.data.amountReceived,
    paymentReference: parsed.data.reference,
  })

  if (!result.ok) return { ok: false, error: result.error }

  revalidatePaymentPages(storeId)
  return {
    ok: true,
    message: result.alreadyClosed
      ? `โต๊ะนี้ปิดบิลไปแล้วด้วยบิล ${result.saleNumber}`
      : `ปิดบิล ${result.saleNumber} เรียบร้อยแล้ว — ยอดสุทธิ ${result.total.toFixed(2)} บาท`,
    data: { saleNumber: result.saleNumber },
  }
}

export type StaffPromptPayQr = {
  /// AUTO = QR ของธนาคาร (โหมด SCB) — ธนาคารยืนยันแล้วบิลปิดเอง · MANUAL = QR พร้อมเพย์ของร้าน พนักงานกดยืนยันเอง
  mode: "AUTO" | "MANUAL"
  dataUrl: string
  amount: number
  /// เลขพร้อมเพย์ของร้านแบบปิดบางหลัก (MANUAL) — ให้พนักงานเทียบกับชื่อบัญชีในแอปลูกค้าได้
  maskedId: string | null
  /// ref1 ของ QR ธนาคาร (AUTO) — ไว้ค้นในแอปธนาคารถ้า callback ไม่มา
  ref1: string | null
}

/// พนักงานกด "แสดง QR ให้ลูกค้าสแกน" บนหน้าปิดบิล (20f — เจ้าของเจอ 2026-09-24 ว่าเลือกพร้อมเพย์แล้วบิลปิดเลยโดยไม่มี QR)
///
/// **ยอดคิดที่ server จากบิลจริงเสมอ** ไม่รับยอดจากหน้าจอ · ไม่ปิดบิล — แค่ออก QR
/// โหมดตามร้าน (`getStorePaymentProfile`): ร้านที่ธนาคารปิดบิลให้ได้ (SCB) = QR ธนาคารพก ref1 ผ่าน `issuePaymentIntent` ตัวเดียวกับหน้าลูกค้า
/// (กดซ้ำได้ใบเดิมถ้ายอดไม่เปลี่ยน) · ร้านอื่น = QR พร้อมเพย์ของร้านตามยอด
export async function prepareStaffPromptPay(formData: FormData): Promise<ActionResult<StaffPromptPayQr>> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_TABLES", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const sessionId = String(formData.get("sessionId") ?? "")
  if (!sessionId) return { ok: false, error: "ไม่พบบิลที่ต้องการชำระ" }

  const session = await db.tableSession.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      orders: { select: { items: { where: { status: { not: "CANCELLED" } }, select: { quantity: true, unitPrice: true } } } },
    },
  })
  if (!session) return { ok: false, error: "ไม่พบบิลที่ต้องการชำระ" }
  if (session.status !== "OPEN" && session.status !== "AWAITING_BILL") return { ok: false, error: "บิลนี้ปิดหรือถูกยกเลิกไปแล้ว" }

  const settings = await db.storeSettings.findUnique({ where: { storeId }, select: { serviceChargePercent: true } })
  const { total } = computeBillTotals(
    session.orders.flatMap((o) => o.items).map((item) => ({ quantity: item.quantity, unitPrice: toNumber(item.unitPrice) })),
    toNumber(settings?.serviceChargePercent ?? 0),
  )
  if (total <= 0) return { ok: false, error: "บิลนี้ยังไม่มียอดที่ต้องชำระ" }

  const profile = await getStorePaymentProfile(storeId)
  const scb = profile.autoSettle ? await getStoreScb(storeId) : null
  if (scb) {
    const intent = await issuePaymentIntent(storeId, sessionId, total)
    const issued = await createQrCode(scb.creds, { amount: total, ref1: intent.ref1 })
    if (issued.ok) {
      const dataUrl = await QRCode.toDataURL(issued.data, { width: 360, margin: 1, errorCorrectionLevel: "M" })
      // ใบนี้นับเข้า "รอธนาคารยืนยัน" บนผังโต๊ะเหมือนใบที่ลูกค้าออกเอง
      publishStoreEvent(storeId, "payments")
      return { ok: true, message: "สร้าง QR ธนาคารแล้ว", data: { mode: "AUTO", dataUrl, amount: total, maskedId: null, ref1: intent.ref1 } }
    }
    // ธนาคารล่ม — ถอยไปใช้พร้อมเพย์ของร้านแบบกดยืนยันเอง เหมือนหน้าลูกค้า
    console.error("[scb] ออก QR ที่หน้าปิดบิลไม่สำเร็จ ถอยไปใช้พร้อมเพย์ของร้าน:", issued.error)
  }

  if (!profile.promptPayId) {
    return { ok: false, error: "ร้านยังไม่ได้ตั้งเลขพร้อมเพย์ — เจ้าของร้านตั้งได้ที่ ตั้งค่าร้าน → การรับเงินจากลูกค้า" }
  }
  const payload = buildPromptPayPayload(total, profile.promptPayId)
  if (!payload) return { ok: false, error: "เลขพร้อมเพย์ของร้านใช้สร้าง QR ไม่ได้ กรุณาตรวจสอบที่ตั้งค่าร้าน" }
  const dataUrl = await QRCode.toDataURL(payload, { width: 360, margin: 1, errorCorrectionLevel: "M" })
  const id = profile.promptPayId
  const maskedId = id.length > 6 ? `${id.slice(0, 3)}xxxx${id.slice(-3)}` : id
  return { ok: true, message: "สร้าง QR พร้อมเพย์แล้ว", data: { mode: "MANUAL", dataUrl, amount: total, maskedId, ref1: null } }
}

/// หน้าปิดบิลโหมด SCB ถามว่าบิลปิดแล้วหรือยัง (20f) — อ่านอย่างเดียว **ห้ามยิงถามธนาคาร**
/// (callback เป็นทางเดียวที่ปิดบิลอัตโนมัติ — ตัดสินใจ 2026-09-09 ดู CLAUDE.md)
export async function getStaffBillStatus(formData: FormData): Promise<ActionResult<{ closed: boolean; saleNumber: string | null }>> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_TABLES", "VIEW"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const sessionId = String(formData.get("sessionId") ?? "")
  const session = await forStore(ctx.storeId).tableSession.findUnique({
    where: { id: sessionId },
    select: { status: true, sale: { select: { saleNumber: true } } },
  })
  if (!session) return { ok: false, error: "ไม่พบบิลนี้" }
  return {
    ok: true,
    message: "",
    data: { closed: session.status === "CLOSED" || session.status === "CANCELLED", saleNumber: session.sale?.saleNumber ?? null },
  }
}

/// ลูกค้ากด "ชำระเงิน" บนหน้า /order/[qrToken]/pay (F17)
///
/// **ไม่เรียก `requireUser()` โดยตั้งใจ** เหมือน action อื่นใน app/actions/customer-order.ts —
/// ลูกค้าไม่มีบัญชีในระบบ ตัวระบุตัวตนคือ qrToken · action นี้ไม่ปิดบิลเอง เพียงแค่ตั้งโต๊ะเป็น
/// "รอเช็กบิล" แล้วแจ้งพนักงาน การปิดบิลจริงมาจาก webhook หรือพนักงานกดยืนยันเท่านั้น
export async function startCustomerPayment(
  formData: FormData,
): Promise<ActionResult<{ total: number }>> {
  const parsed = startPaymentSchema.safeParse({
    qrToken: formData.get("qrToken") ?? "",
    method: formData.get("method") ?? "",
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { qrToken, method } = parsed.data

  try {
    // ร้านของลูกค้า = ร้านเจ้าของ qrToken (Phase 13)
    const store = await findStoreByQrToken(qrToken)
    if (!store) throw new PaymentAbort("ไม่พบ QR Code นี้ในระบบ กรุณาแจ้งพนักงาน")
    if (store.status === "SUSPENDED") throw new PaymentAbort("ร้านนี้ปิดรับออเดอร์ชั่วคราว กรุณาแจ้งพนักงาน")
    const storeId = store.storeId

    const total = await forStore(storeId).$transaction(async (tx) => {
      const qr = await tx.qRCode.findUnique({
        where: { token: qrToken },
        select: { status: true, tableId: true, table: { select: { primaryTableId: true } } },
      })
      if (!qr) throw new PaymentAbort("ไม่พบ QR Code นี้ในระบบ กรุณาแจ้งพนักงาน")
      if (qr.status === "INVALIDATED") {
        throw new PaymentAbort("QR Code นี้ใช้ไม่ได้แล้ว กรุณาแจ้งพนักงานให้เปิดโต๊ะใหม่")
      }

      const tableId = qr.table.primaryTableId ?? qr.tableId
      // ห้องสปาที่มีหลายบิล — QR ของห้องไม่รู้ว่าเป็นลูกค้าคนไหน ห้ามออก QR จ่ายให้บิลที่เดาเอา (20e)
      if (await hasMultipleOpenBills(tx, tableId)) throw new PaymentAbort(SHARED_ROOM_PAYMENT_MESSAGE)
      const session = await tx.tableSession.findFirst({
        where: { tableId, status: { in: ["OPEN", "AWAITING_BILL"] } },
        orderBy: { openedAt: "desc" },
        select: { id: true, tableId: true },
      })
      if (!session) throw new PaymentAbort("โต๊ะนี้ปิดบิลไปแล้ว หรือยังไม่ได้เปิดใช้งาน")

      const items = await tx.mobileOrderItem.findMany({
        where: { order: { tableSessionId: session.id }, status: { not: "CANCELLED" } },
        select: { quantity: true, unitPrice: true },
      })
      if (items.length === 0) throw new PaymentAbort("โต๊ะนี้ยังไม่มีรายการที่ต้องชำระ")

      const settings = await tx.storeSettings.findUnique({
        where: { storeId },
        select: { serviceChargePercent: true },
      })
      const totals = computeBillTotals(
        items.map((item) => ({ quantity: item.quantity, unitPrice: toNumber(item.unitPrice) })),
        toNumber(settings?.serviceChargePercent ?? 0),
      )

      await tx.tableSession.updateMany({
        where: { id: session.id, status: "OPEN" },
        data: { status: "AWAITING_BILL" },
      })
      await tx.table.update({ where: { id: session.tableId }, data: { status: "AWAITING_BILL" } })

      // แจ้งพนักงานครั้งเดียวต่อรอบ — ลูกค้ากดสลับวิธีจ่ายไปมาไม่ควรถล่มหน้าแจ้งเตือน
      const pending = await tx.notification.findFirst({
        where: { tableSessionId: session.id, type: "CHECK_BILL", status: "PENDING" },
        select: { id: true },
      })
      const reason = method === "PROMPTPAY" ? "ลูกค้าเลือกชำระด้วยพร้อมเพย์" : "ลูกค้าขอชำระด้วยบัตรที่เคาน์เตอร์"
      if (pending) {
        await tx.notification.update({ where: { id: pending.id }, data: { reason } })
      } else {
        await tx.notification.create({
          data: { storeId, tableSessionId: session.id, type: "CHECK_BILL", reason },
        })
      }

      return totals.total
    })

    revalidatePaymentPages(storeId)
    return {
      ok: true,
      message: method === "PROMPTPAY" ? "สแกน QR เพื่อชำระเงินได้เลย" : "แจ้งพนักงานแล้ว กรุณาชำระด้วยบัตรที่เคาน์เตอร์",
      data: { total },
    }
  } catch (error) {
    if (error instanceof PaymentAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "เริ่มการชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ลูกค้าแนบสลิปโอนเงิน (Phase 15b — โหมด ก+) → ตรวจกับผู้ให้บริการ → ปิดบิลเองถ้าผ่านครบ 4 ด่าน (lib/slip-settle.ts)
/// ตัวระบุตัวตนคือ qrToken เหมือน startCustomerPayment · ไม่ผ่าน = ไม่ปิดบิล บอกเหตุผล (ยอดขาด/ผู้ให้บริการล่ม → แจ้งพนักงานแล้ว)
export async function submitPaymentSlip(formData: FormData): Promise<ActionResult<{ saleNumber: string }>> {
  const parsed = submitSlipSchema.safeParse({ qrToken: formData.get("qrToken") ?? "", payload: formData.get("payload") ?? "" })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  const { qrToken, payload } = parsed.data

  const store = await findStoreByQrToken(qrToken)
  if (!store) return { ok: false, error: "ไม่พบ QR Code นี้ในระบบ กรุณาแจ้งพนักงาน" }
  if (store.status === "SUSPENDED") return { ok: false, error: "ร้านนี้ปิดรับออเดอร์ชั่วคราว กรุณาแจ้งพนักงาน" }

  const qr = await forStore(store.storeId).qRCode.findUnique({
    where: { token: qrToken },
    select: { status: true, tableId: true, table: { select: { primaryTableId: true } } },
  })
  if (!qr) return { ok: false, error: "ไม่พบ QR Code นี้ในระบบ กรุณาแจ้งพนักงาน" }
  const tableId = qr.table.primaryTableId ?? qr.tableId
  // เหตุผลเดียวกับ startCustomerPayment — สลิปจากห้องที่มีหลายบิลไม่รู้ว่าจะปิดบิลของใคร (20e)
  if (await hasMultipleOpenBills(forStore(store.storeId), tableId)) return { ok: false, error: SHARED_ROOM_PAYMENT_MESSAGE }
  const session = await forStore(store.storeId).tableSession.findFirst({
    where: { tableId, status: { in: ["OPEN", "AWAITING_BILL"] } },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  })
  if (!session) {
    // ลูกค้ากดส่งซ้ำหลังบิลปิดไปแล้ว (เน็ตช้า/กดสองครั้ง) — ถ้าสลิปใบนี้คือใบที่ปิดโต๊ะนี้ ให้ตอบสำเร็จซ้ำ ไม่ใช่ error
    const parsed = parseSlipQr(payload)
    const paid = parsed
      ? await forStore(store.storeId).sale.findFirst({
          where: { paymentReference: slipPaymentReference(parsed.transRef), session: { tableId } },
          select: { saleNumber: true },
        })
      : null
    if (paid) return { ok: true, message: "บิลนี้ชำระแล้ว", data: { saleNumber: paid.saleNumber } }
    return { ok: false, error: "โต๊ะนี้ปิดบิลไปแล้ว หรือยังไม่ได้เปิดใช้งาน" }
  }

  const result = await verifySlipAndSettle({ storeId: store.storeId, sessionId: session.id, payload })
  if (!result.ok) return { ok: false, error: result.reason }

  revalidatePath(`/order/${qrToken}`, "layout")
  revalidatePath("/mobile-order/tables")
  return { ok: true, message: result.alreadyClosed ? "บิลนี้ชำระแล้ว" : "ตรวจสลิปผ่าน — ปิดบิลเรียบร้อยแล้ว", data: { saleNumber: result.saleNumber } }
}
