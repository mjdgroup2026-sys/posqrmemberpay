"use server"

import { revalidatePath } from "next/cache"
import { forStore, type StoreTx } from "@/lib/db"
import { requireSellingStore, storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { publishStoreEvent } from "@/lib/realtime"
import { buildOrderLines, OrderLineError, type OrderLine } from "@/lib/order-lines"
import { LIVE_SESSION_STATUS, openOrReuseSession, SessionError } from "@/lib/table-session"
import { printKitchenTicket, isPrinterConfigured } from "@/lib/kitchen-printer"
import { nextSaleNumber } from "@/lib/sale-number"
import { businessDayRange } from "@/lib/day"
import { orderTicketLabel } from "@/lib/order-label"
import { getStorePaymentProfile } from "@/lib/payment-methods"
import { buildPromptPayPayload } from "@/lib/promptpay"
import QRCode from "qrcode"
import {
  staffTableOrderSchema,
  takeawaySaleSchema,
  parseCartJson,
  firstIssueMessage,
  zodToFieldErrors,
} from "@/lib/validation"
import type { ActionResult, ReceiptData } from "@/lib/types"

/// จอขายอาหารฝั่งพนักงาน (Phase 17b) — พนักงานกดสั่งแทนลูกค้าที่โต๊ะ
///
/// ใช้ของเดิมทั้งหมดโดยตั้งใจ: บรรทัดอาหาร/ราคาผ่าน `buildOrderLines()` ตัวเดียวกับที่ลูกค้าสแกน QR ใช้ ·
/// เปิด/หา session ผ่าน `openOrReuseSession()` ตัวเดียวกับผังโต๊ะ · **ปิดบิลยังเป็นเส้นทางเดิม**
/// (`/mobile-order/tables/[tableId]/billing` → `closeSessionWithPayment`) ไม่มีทางปิดบิลใหม่ในไฟล์นี้

/// revalidate + สัญญาณ SSE (กติกาข้อ 12) — เรียกหลังเขียน DB สำเร็จเท่านั้น
function revalidateStaffOrderPages(storeId: string) {
  publishStoreEvent(storeId, "orders")
  publishStoreEvent(storeId, "tables")
  revalidatePath("/mobile-order/pos")
  revalidatePath("/mobile-order/tables")
  revalidatePath("/mobile-order/kitchen")
}

export type StaffOrderResult = {
  orderId: string
  orderNumber: number
  sessionId: string
  tableId: string
  tableCode: string
  /// เปิดโต๊ะใหม่ให้หรือเข้าบิลเดิมที่เปิดอยู่แล้ว
  openedNewTable: boolean
  total: number
  printed: boolean
}

class StaffOrderAbort extends Error {
  constructor(readonly reason: string) {
    super("STAFF_ORDER_ABORT")
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/// พนักงานส่งออร์เดอร์เข้าโต๊ะ — โต๊ะว่างจะถูกเปิดให้อัตโนมัติ (พนักงานไม่ต้องไปกดเปิดที่ผังโต๊ะก่อน)
export async function createStaffTableOrder(formData: FormData): Promise<ActionResult<StaffOrderResult>> {
  let ctx: StoreContext
  try {
    // ขายใหม่ = ต้องมีสิทธิ์ MO_POS:ADD และแพ็กเกจต้องยังไม่หมดอายุ (กติกาข้อ 5 · Phase 14b)
    ctx = await requireStoreAccess(["MO_POS", "ADD"])
    await requireSellingStore()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = staffTableOrderSchema.safeParse({
    tableId: formData.get("tableId") ?? "",
    sessionId: formData.get("sessionId") ?? undefined,
    newCustomer: formData.get("newCustomer") === "true",
    billLabel: formData.get("billLabel") ?? undefined,
    items: parseCartJson(formData.get("items")),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { tableId, items, sessionId, newCustomer, billLabel } = parsed.data

  try {
    const created = await db.$transaction(async (tx) => {
      // ห้องสปาที่มีบิลเปิดอยู่แล้ว ต้องบอกให้ชัดว่าส่งเข้าบิลไหน (2026-09-23) — เดิมเข้าบิลล่าสุดเสมอ
      // ลูกค้าคนใหม่จึงถูกรวมบิลกับคนก่อนที่ยังไม่จ่าย · โต๊ะอาหารยังเป็นบิลเดียวต่อโต๊ะเหมือนเดิม
      if (!sessionId && !newCustomer) {
        const room = await tx.table.findUnique({ where: { id: tableId }, select: { kind: true, code: true } })
        const openBills = room?.kind === "ROOM"
          ? await tx.tableSession.count({ where: { tableId, status: { in: LIVE_SESSION_STATUS } } })
          : 0
        if (openBills > 0) {
          throw new StaffOrderAbort(`ห้อง ${room?.code ?? ""} มีบิลเปิดอยู่ — เลือกว่าจะเพิ่มในบิลเดิม หรือเปิดบิลใหม่ให้ลูกค้าคนใหม่`)
        }
      }
      if (newCustomer && !billLabel) {
        const openBills = await tx.tableSession.count({ where: { tableId, status: { in: LIVE_SESSION_STATUS } } })
        if (openBills > 0) throw new StaffOrderAbort("กรุณากรอกชื่อลูกค้าของบิลใหม่ เพื่อแยกกับบิลที่เปิดอยู่ในห้องนี้")
      }

      const session = await openOrReuseSession(
        tx,
        storeId,
        sessionId ? { tableId, sessionId } : newCustomer ? { tableId, newCustomer: { label: billLabel ?? null } } : { tableId },
      )

      // โต๊ะที่ลูกค้าขอเช็กบิลแล้ว สั่งเพิ่มไม่ได้ — กติกาเดียวกับฝั่งลูกค้า (ยอดถูกล็อกไว้รอจ่าย)
      if (session.status === "AWAITING_BILL") {
        throw new StaffOrderAbort(
          `โต๊ะ ${session.tableCode} ขอเช็กบิลแล้ว สั่งเพิ่มไม่ได้ — ปิดบิลก่อนแล้วเปิดโต๊ะใหม่`,
        )
      }

      // จอขายพนักงาน: บรรทัดบริการต้องมีพนักงานนวดตั้งแต่ตอนส่ง (Phase 20) — ลูกค้าสั่งเองผ่าน QR ไม่บังคับ
      const rows = await buildOrderLines(tx, items, { requireTherapistForService: true })

      // เลขรอบสั่งต่อ session — unique (tableSessionId, orderNumber) เป็นด่านจริงถ้ากดส่งซ้อนกัน
      const last = await tx.mobileOrder.findFirst({
        where: { tableSessionId: session.sessionId },
        orderBy: { orderNumber: "desc" },
        select: { orderNumber: true },
      })
      const orderNumber = (last?.orderNumber ?? 0) + 1

      const order = await tx.mobileOrder.create({
        data: {
          storeId,
          tableSessionId: session.sessionId,
          orderNumber,
          items: {
            create: rows.map((row) => ({
              menuItemId: row.menuItemId,
              quantity: row.quantity,
              unitPrice: row.unitPrice.toFixed(2),
              note: row.note,
              selectedOptionsSnapshot: row.options,
              therapistId: row.therapistId,
            })),
          },
        },
        select: { id: true, orderNumber: true, submittedAt: true },
      })

      // โต๊ะเปลี่ยนเป็น "สั่งแล้ว" ในทรานแซคชันเดียวกับการสร้างออร์เดอร์เสมอ (denormalized field)
      await tx.table.update({ where: { id: session.tableId }, data: { status: "ORDERED" } })

      return { order, rows, session }
    })

    // พิมพ์ทิกเก็ตหลัง commit — พิมพ์ไม่ผ่านต้องไม่ทำให้ออร์เดอร์หาย
    const printed = await printTicketAfterCommit(db, created.order, created.session.tableCode, created.rows)

    revalidateStaffOrderPages(storeId)
    const total = round2(created.rows.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0))
    return {
      ok: true,
      message: `ส่งออร์เดอร์ที่ ${created.order.orderNumber} ของโต๊ะ ${created.session.tableCode} เข้าครัวแล้ว`,
      data: {
        orderId: created.order.id,
        orderNumber: created.order.orderNumber,
        sessionId: created.session.sessionId,
        tableId: created.session.tableId,
        tableCode: created.session.tableCode,
        openedNewTable: !created.session.reused,
        total,
        printed,
      },
    }
  } catch (error) {
    if (error instanceof StaffOrderAbort) return { ok: false, error: error.reason }
    // ทั้งสองตัวเก็บข้อความไทยพร้อมแสดงไว้ในตัวเองแล้ว
    if (error instanceof SessionError) return { ok: false, error: error.reason }
    if (error instanceof OrderLineError) return { ok: false, error: error.reason }
    return { ok: false, error: "ส่งออร์เดอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// พิมพ์ทิกเก็ตครัวหลัง commit แล้วบันทึกเวลาพิมพ์ — คืน false เมื่อไม่ได้ตั้งเครื่องพิมพ์ไว้หรือพิมพ์ไม่ผ่าน
async function printTicketAfterCommit(
  db: ReturnType<typeof forStore>,
  order: { id: string; orderNumber: number; submittedAt: Date },
  tableCode: string,
  rows: OrderLine[],
): Promise<boolean> {
  if (!isPrinterConfigured()) return false
  // ทิกเก็ตครัวพิมพ์เฉพาะอาหาร — โปรแกรมนวด (SERVICE) ไปขึ้นกระดานพนักงานนวดแทน (Phase 20) · ไม่มีอาหารเลย = ไม่พิมพ์
  const foodRows = rows.filter((row) => row.itemType === "FOOD")
  if (foodRows.length === 0) return false

  const printed = await printKitchenTicket({
    tableCode,
    orderNumber: order.orderNumber,
    submittedAt: order.submittedAt,
    items: foodRows.map((row) => ({
      quantity: row.quantity,
      name: row.menuItemName,
      options: row.options.map((o) => o.optionName),
      note: row.note,
      stationId: row.stationId,
      stationName: row.stationName,
    })),
  })
  if (printed) {
    await db.mobileOrder.update({ where: { id: order.id }, data: { printedAt: new Date() } })
  }
  return printed
}

// ───────────────────── ขายกลับบ้าน (Phase 17c) ─────────────────────

/// เลขคิวของออร์เดอร์กลับบ้าน — เดินต่อรายวันต่อร้าน (ครัวเรียก "กลับบ้าน #3" ไม่ใช่เลขบิลยาว ๆ)
///
/// ปลอดภัยเพราะถูกเรียก **หลัง** `nextSaleNumber()` ซึ่งจับ `pg_advisory_xact_lock` ต่อร้านไว้แล้ว
/// ในทรานแซคชันเดียวกัน — คำขอที่วิ่งพร้อมกันจึงต่อคิวกันอยู่ดี ไม่ต้องมี lock ตัวที่สอง
async function nextTakeawayNumber(tx: StoreTx, storeId: string): Promise<number> {
  const { start, end } = businessDayRange()
  const last = await tx.mobileOrder.findFirst({
    where: { storeId, orderType: "TAKEAWAY", submittedAt: { gte: start, lt: end } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  })
  return (last?.orderNumber ?? 0) + 1
}

export type TakeawaySaleResult = {
  orderId: string
  orderNumber: number
  receipt: ReceiptData
  printed: boolean
}

/// พนักงานขายอาหารกลับบ้าน — รับเงินตอนสั่ง ออกบิลทันที และส่งเข้าครัวในทรานแซคชันเดียวกัน
///
/// ต่างจากบิลของโต๊ะตรงที่ **ไม่มี TableSession** จึงใช้ `channel = TAKEAWAY` (กติกาข้อ 8 สงวน
/// MOBILE_ORDER ไว้ให้บิลที่มี tableSessionId เสมอ) · **ไม่คิดค่าบริการ** เพราะค่าบริการเป็นของการนั่งกินที่ร้าน
/// · เมนูอาหารไม่มีสต็อกในระบบ จึงไม่ตัด `Product.quantity` และไม่มี `StockTransaction`
export async function createTakeawaySale(formData: FormData): Promise<ActionResult<TakeawaySaleResult>> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_POS", "ADD"])
    await requireSellingStore()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = takeawaySaleSchema.safeParse({
    items: parseCartJson(formData.get("items")),
    paymentMethod: formData.get("paymentMethod") ?? "",
    amountReceived: formData.get("amountReceived") ?? 0,
    customerLabel: formData.get("customerLabel") ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { items, paymentMethod, amountReceived, customerLabel } = parsed.data

  // เลขบิลชนกันได้ถ้ามีคนกดรับเงินพร้อมกัน — เจอ P2002 แล้ว retry ทั้งทรานแซคชันใหม่ (เหมือน createSale)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const rows = await buildOrderLines(tx, items)
        const total = round2(rows.reduce((sum, row) => sum + row.unitPrice * row.quantity, 0))

        if (paymentMethod === "CASH" && amountReceived < total) {
          throw new StaffOrderAbort(`เงินที่รับไม่พอ — ต้องชำระ ${total.toFixed(2)} บาท`)
        }
        // โอน/QR ไม่มีเงินทอน — บังคับให้ตรงยอดเสมอ ไม่เชื่อค่าที่ client ส่งมา (เหมือนหน้า POS)
        const received = paymentMethod === "CASH" ? round2(amountReceived) : total
        const changeDue = paymentMethod === "CASH" ? round2(received - total) : 0

        const saleNumber = await nextSaleNumber(tx, storeId)

        const sale = await tx.sale.create({
          data: {
            storeId,
            saleNumber,
            channel: "TAKEAWAY",
            subtotal: total.toFixed(2),
            discount: "0.00",
            total: total.toFixed(2),
            paymentMethod,
            amountReceived: received.toFixed(2),
            changeDue: changeDue.toFixed(2),
            note: customerLabel ? `กลับบ้าน · ${customerLabel}` : "กลับบ้าน",
            cashierId: ctx.user.id,
            items: {
              create: rows.map((row) => ({
                menuItemId: row.menuItemId,
                name: row.menuItemName,
                kind: row.itemType,
                quantity: row.quantity,
                unitPrice: row.unitPrice.toFixed(2),
                subtotal: round2(row.unitPrice * row.quantity).toFixed(2),
              })),
            },
          },
          select: { id: true, saleNumber: true, createdAt: true },
        })

        const orderNumber = await nextTakeawayNumber(tx, storeId)
        const order = await tx.mobileOrder.create({
          data: {
            storeId,
            orderType: "TAKEAWAY",
            saleId: sale.id,
            customerLabel: customerLabel ?? null,
            orderNumber,
            items: {
              create: rows.map((row) => ({
                menuItemId: row.menuItemId,
                quantity: row.quantity,
                unitPrice: row.unitPrice.toFixed(2),
                note: row.note,
                selectedOptionsSnapshot: row.options,
              })),
            },
          },
          select: { id: true, orderNumber: true, submittedAt: true },
        })

        const receipt: ReceiptData = {
          id: sale.id,
          saleNumber: sale.saleNumber,
          createdAt: sale.createdAt.toISOString(),
          cashierName: ctx.user.name,
          items: rows.map((row) => ({
            productId: row.menuItemId,
            name: row.menuItemName,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            subtotal: round2(row.unitPrice * row.quantity),
          })),
          subtotal: total,
          discount: 0,
          total,
          paymentMethod,
          amountReceived: received,
          changeDue,
          note: customerLabel ? `กลับบ้าน · ${customerLabel}` : "กลับบ้าน",
        }

        return { order, rows, receipt }
      })

      const label = orderTicketLabel({
        orderType: "TAKEAWAY",
        tableCode: null,
        orderNumber: created.order.orderNumber,
        customerLabel,
      })
      const printed = await printTicketAfterCommit(db, created.order, label, created.rows)

      revalidateTakeawayPages(storeId)
      return {
        ok: true,
        message: `รับเงินและส่งเข้าครัวแล้ว — บิล ${created.receipt.saleNumber} (${label})`,
        data: {
          orderId: created.order.id,
          orderNumber: created.order.orderNumber,
          receipt: created.receipt,
          printed,
        },
      }
    } catch (error) {
      if (error instanceof StaffOrderAbort) return { ok: false, error: error.reason }
      if (error instanceof OrderLineError) return { ok: false, error: error.reason }
      // เลขบิลชนกัน — วนไปออกเลขใหม่ (ทุกอย่างถูก rollback ไปแล้ว)
      if ((error as { code?: string }).code === "P2002") continue
      return { ok: false, error: "รับเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
    }
  }

  return { ok: false, error: "ออกเลขที่บิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
}

/// บิลกลับบ้านโผล่ในทุกหน้ารายงานเหมือนบิลอื่น จึง revalidate ให้ครบ (กติกาข้อ 8)
function revalidateTakeawayPages(storeId: string) {
  publishStoreEvent(storeId, "orders")
  revalidatePath("/mobile-order/pos")
  revalidatePath("/mobile-order/kitchen")
  revalidatePath("/pos/history")
  revalidatePath("/pos/closing")
  revalidatePath("/reports")
  revalidatePath("/")
}

// ───────────────────── QR พร้อมเพย์ให้ลูกค้าสแกนที่หน้าร้าน (2026-09-17) ─────────────────────

export type StorePromptPayQr = {
  /// รูป QR (data URL) ที่ฝัง payload EMVCo ของร้าน + ยอดที่ต้องจ่าย
  dataUrl: string
  /// เลขพร้อมเพย์ปิดบางหลัก ไว้ให้พนักงานอ่านยืนยันกับลูกค้า
  maskedId: string
  amount: number
}

/// สร้าง QR พร้อมเพย์ของร้านตามยอดที่พนักงานกำลังรับเงิน — ใช้ทั้งจอขายอาหาร (กลับบ้าน) และ POS หน้าร้าน
///
/// เลขผู้รับมาจาก `getStorePaymentProfile()` เท่านั้น (กติกาข้อ 10) — ไม่มี default จาก env · เป็น QR แบบ "ให้ลูกค้าสแกน
/// แล้วพนักงานกดยืนยันเอง" ไม่มี callback ปิดบิล (เหมือนโหมด PROMPTPAY_DIRECT ฝั่งลูกค้า) · ร้านที่ยังไม่ตั้งเลข
/// ได้ข้อความบอกทางไปตั้งค่า ไม่ใช่ QR เปล่า
export async function buildStorePromptPayQr(formData: FormData): Promise<ActionResult<StorePromptPayQr>> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_POS", "ADD"], ["POS", "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }

  const amount = Number(formData.get("amount") ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "ยอดที่ต้องชำระไม่ถูกต้อง" }

  const profile = await getStorePaymentProfile(ctx.storeId)
  if (!profile.promptPayId) {
    return {
      ok: false,
      error: "ร้านยังไม่ได้ตั้งเลขพร้อมเพย์ — เจ้าของร้านตั้งได้ที่ ตั้งค่าร้าน → การรับเงินจากลูกค้า",
    }
  }

  const payload = buildPromptPayPayload(round2(amount), profile.promptPayId)
  if (!payload) return { ok: false, error: "เลขพร้อมเพย์ของร้านใช้สร้าง QR ไม่ได้ กรุณาตรวจสอบที่ตั้งค่าร้าน" }

  const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 260 })
  const id = profile.promptPayId
  const maskedId = id.length > 6 ? `${id.slice(0, 3)}xxxx${id.slice(-3)}` : id
  return { ok: true, message: "สร้าง QR แล้ว", data: { dataUrl, maskedId, amount: round2(amount) } }
}
