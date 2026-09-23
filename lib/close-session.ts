import "server-only"
import { forStore, type StoreTx } from "@/lib/db"
import { nextSaleNumber } from "@/lib/sale-number"
import { toNumber } from "@/lib/format"
import type { PaymentMethodValue } from "@/lib/types"
import { publishStoreEvent } from "@/lib/realtime"
import { releaseTableIfIdle } from "@/lib/table-session"

/// ปิดบิลของโต๊ะ (MJD Mobile Order) — ใช้ร่วมกันระหว่างพนักงานกดยืนยันกับ webhook ของธนาคาร
///
/// กติกาที่ทุกทางเรียกต้องได้เหมือนกัน (§3 การชำระเงินและปิดบิลอัตโนมัติ):
/// 1. บิลออกเป็น `Sale` ปกติเสมอ (channel = MOBILE_ORDER) — ห้ามมีตารางบิลแยก (กติกาข้อ 8)
/// 2. ทุกขั้นอยู่ในทรานแซคชันเดียว: สร้าง Sale+SaleItem → ปิด session → invalidate DYNAMIC QR →
///    คืนโต๊ะทั้งกลุ่มเป็นว่าง
/// 3. idempotent ด้วย `Sale.paymentReference` (unique) — webhook ที่ยิงซ้ำต้องไม่สร้างบิลซ้ำ

/// ผู้ใช้ที่ถูกบันทึกเป็นแคชเชียร์ของบิลที่ระบบปิดเอง — เป็นตัวแยกเดียวที่บอกได้ว่า
/// "ลูกค้าจ่ายเอง ระบบปิดให้" ต่างจากบิลที่พนักงานกดปิดเอง (ดู `listCustomerPaidBills()`)
export const SYSTEM_USER_ID = "system"

export type ClosePaymentInput = {
  /// ร้านเจ้าของโต๊ะ (Phase 13) — ผู้เรียกต้องรู้แล้วว่าเป็นร้านไหน (พนักงาน: requireStore · webhook: ref1)
  storeId: string
  sessionId: string
  paymentMethod: Extract<PaymentMethodValue, "PROMPTPAY" | "CARD" | "CASH" | "TRANSFER">
  /// พนักงานที่กดยืนยัน — เว้นว่างเมื่อมาจาก webhook (จะใช้ผู้ใช้ระบบแทน)
  cashierId?: string
  paymentReference?: string
  amountReceived?: number
  /// ยอดที่ **ธนาคารยืนยันว่าได้รับจริง** — ตั้งเฉพาะเส้นทางที่ปิดบิลจากเงินที่โอนเข้ามาแล้ว
  /// (ตอนนี้มีทางเดียวคือ callback ของ SCB) ถ้าบิลปัจจุบันแพงกว่ายอดนี้ให้ยกเลิกทั้งทรานแซคชัน
  ///
  /// จำเป็นเพราะยอดถูกล็อกไว้ตอนออก QR แต่บิลยังโตต่อได้: ลูกค้าอีกคนบนโต๊ะเดียวกันสั่งเพิ่ม
  /// ระหว่างที่คนแรกกำลังจ่ายอยู่ · เทียบแค่กับ `PaymentIntent.amount` ไม่พอ เพราะนั่นคือยอดเก่า
  /// ต้องเทียบกับยอดที่คำนวณสดในทรานแซคชันนี้จึงจะกันเงินขาดได้จริง
  verifiedAmount?: number
  note?: string
}

export type ClosePaymentResult =
  | { ok: true; saleId: string; saleNumber: string; total: number; alreadyClosed: boolean }
  | { ok: false; error: string }

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export type BillLine = { quantity: number; unitPrice: number }
export type BillTotals = { itemsTotal: number; serviceCharge: number; subtotal: number; total: number }

/// สูตรคิดยอดบิลของ MJD Mobile Order — ใช้ร่วมกันระหว่างหน้าปิดบิลฝั่งพนักงาน หน้าชำระเงินฝั่งลูกค้า
/// และตอนสร้าง Sale จริง · ห้ามคำนวณซ้ำที่อื่น มิฉะนั้นตัวเลขบนจอกับตัวเลขในบิลจะเพี้ยนกันได้
export function computeBillTotals(lines: BillLine[], servicePercent: number): BillTotals {
  const itemsTotal = round2(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))
  const serviceCharge = round2((itemsTotal * servicePercent) / 100)
  // ค่าบริการถูกบวกเข้า subtotal ก่อนคิด total ตาม §3 (v1 ไม่มีส่วนลดในช่องทางนี้)
  const subtotal = round2(itemsTotal + serviceCharge)
  return { itemsTotal, serviceCharge, subtotal, total: subtotal }
}

class CloseAbort extends Error {
  constructor(readonly reason: string) {
    super("CLOSE_ABORT")
  }
}

/// ผู้ใช้ระบบสำหรับบิลที่ปิดเองอัตโนมัติจาก webhook — Sale.cashierId เป็น FK ที่ห้ามว่าง
/// (ตาราง user ไม่มี storeId — ผู้ใช้ระบบเป็นคนเดียวกันทุกร้าน)
async function ensureSystemUser(tx: StoreTx): Promise<string> {
  const existing = await tx.user.findUnique({ where: { id: SYSTEM_USER_ID }, select: { id: true } })
  if (existing) return existing.id

  const created = await tx.user.create({
    data: {
      id: SYSTEM_USER_ID,
      name: "ระบบ (ชำระเงินอัตโนมัติ)",
      email: "system@mjd-mobile-order.local",
      emailVerified: true,
    },
    select: { id: true },
  })
  return created.id
}

export async function closeSessionWithPayment(input: ClosePaymentInput): Promise<ClosePaymentResult> {
  const db = forStore(input.storeId)
  try {
    const result = await db.$transaction(async (tx) => {
      // ★ กัน webhook ยิงซ้ำ — ตรวจก่อนทำอะไรทั้งหมด แล้วคืนบิลเดิมไปเลย
      if (input.paymentReference) {
        const existing = await tx.sale.findUnique({
          where: { paymentReference: input.paymentReference },
          select: { id: true, saleNumber: true, total: true },
        })
        if (existing) {
          return {
            saleId: existing.id,
            saleNumber: existing.saleNumber,
            total: toNumber(existing.total),
            alreadyClosed: true,
          }
        }
      }

      const session = await tx.tableSession.findUnique({
        where: { id: input.sessionId },
        select: {
          id: true,
          status: true,
          tableId: true,
          qrCodeId: true,
          table: { select: { code: true } },
          orders: {
            select: {
              items: {
                where: { status: { not: "CANCELLED" } },
                select: {
                  menuItemId: true,
                  quantity: true,
                  unitPrice: true,
                  menuItem: { select: { name: true } },
                  therapistId: true,
                },
              },
            },
          },
        },
      })
      if (!session) throw new CloseAbort("ไม่พบโต๊ะที่ต้องการปิดบิล")
      if (session.status === "CLOSED") throw new CloseAbort("โต๊ะนี้ปิดบิลไปแล้ว")
      if (session.status === "CANCELLED") throw new CloseAbort("โต๊ะนี้ถูกยกเลิกไปแล้ว ปิดบิลไม่ได้")

      const lines = session.orders.flatMap((order) => order.items)
      if (lines.length === 0) throw new CloseAbort("โต๊ะนี้ยังไม่มีรายการที่ต้องชำระ")

      const settings = await tx.storeSettings.findUnique({
        where: { storeId: input.storeId },
        select: { serviceChargePercent: true },
      })
      const servicePercent = toNumber(settings?.serviceChargePercent ?? 0)

      const { subtotal, total } = computeBillTotals(
        lines.map((line) => ({ quantity: line.quantity, unitPrice: toNumber(line.unitPrice) })),
        servicePercent,
      )
      const received = input.amountReceived === undefined ? total : round2(input.amountReceived)
      const changeDue = input.paymentMethod === "CASH" ? round2(Math.max(received - total, 0)) : 0

      if (input.paymentMethod === "CASH" && received < total) {
        throw new CloseAbort(`เงินที่รับไม่พอ — ต้องชำระ ${total.toFixed(2)} บาท`)
      }

      // ★ เงินโอนเข้ามาแล้วแต่ไม่พอกับบิลที่โตขึ้นระหว่างทาง — ห้ามปิดบิลเอง ต้องให้พนักงานตรวจ
      //   ตรวจตรงนี้เพราะเป็นจุดเดียวที่ `total` ถูกคำนวณสดอยู่ในทรานแซคชันเดียวกับการปิดบิล
      if (input.verifiedAmount !== undefined && round2(input.verifiedAmount) < total) {
        throw new CloseAbort(
          `เงินที่ได้รับ ${round2(input.verifiedAmount).toFixed(2)} บาท น้อยกว่ายอดบิลปัจจุบัน ` +
            `${total.toFixed(2)} บาท (มีรายการสั่งเพิ่มหลังออก QR)`,
        )
      }

      const cashierId = input.cashierId ?? (await ensureSystemUser(tx))
      const saleNumber = await nextSaleNumber(tx, input.storeId)

      const sale = await tx.sale.create({
        data: {
          storeId: input.storeId,
          saleNumber,
          channel: "MOBILE_ORDER",
          tableSessionId: session.id,
          paymentReference: input.paymentReference,
          subtotal: subtotal.toFixed(2),
          discount: "0.00",
          total: total.toFixed(2),
          paymentMethod: input.paymentMethod,
          amountReceived: received.toFixed(2),
          changeDue: changeDue.toFixed(2),
          note: input.note ?? `โต๊ะ ${session.table.code}`,
          cashierId,
          items: {
            create: lines.map((line) => ({
              menuItemId: line.menuItemId,
              name: line.menuItem.name,
              // พนักงานนวดของบรรทัดบริการ (Phase 20) — snapshot ลงบิลไว้ทำรายงานต่อคน
              therapistId: line.therapistId ?? null,
              quantity: line.quantity,
              unitPrice: toNumber(line.unitPrice).toFixed(2),
              subtotal: round2(toNumber(line.unitPrice) * line.quantity).toFixed(2),
            })),
          },
        },
        select: { id: true, saleNumber: true },
      })

      // ★ conditional update — กันสองทาง (พนักงานกดยืนยัน + webhook) ปิดบิลพร้อมกันแล้วได้ 2 บิล
      const closed = await tx.tableSession.updateMany({
        where: { id: session.id, status: { in: ["OPEN", "AWAITING_BILL"] } },
        data: { status: "CLOSED", closedAt: new Date(), closedById: input.cashierId ?? null },
      })
      if (closed.count === 0) throw new CloseAbort("โต๊ะนี้เพิ่งถูกปิดบิลจากอีกหน้าจอ")

      // คืนโต๊ะเป็นว่าง (พร้อมโต๊ะที่รวมอยู่) — ห้องสปาที่ยังมีบิลของลูกค้าคนอื่นเปิดค้างไม่ถูกคืน (2026-09-23)
      const released = await releaseTableIfIdle(tx, input.storeId, session.tableId)

      // DYNAMIC QR ใช้ต่อไม่ได้อีกหลังปิดบิล · STATIC ไม่ถูกแตะต้อง (§3 QR Code วงจรชีวิต)
      // ห้องที่ยังมีบิลอื่นเปิดอยู่ = QR ยังเป็นของลูกค้าที่ยังอยู่ในห้อง จึงยังไม่ตัด
      if (released) {
        await tx.qRCode.updateMany({
          where: { tableId: session.tableId, type: "DYNAMIC", status: "ACTIVE" },
          data: { status: "INVALIDATED", invalidatedAt: new Date() },
        })
      }

      // คิวนวดที่เช็กอินเข้ามาเป็น session นี้ถือว่าจบพร้อมบิล (Phase 20b) — ไม่งั้นกระดานจะค้างว่ายังนวดอยู่
      await tx.booking.updateMany({
        where: { tableSessionId: session.id, status: { in: ["CHECKED_IN", "IN_SERVICE"] } },
        data: { status: "DONE" },
      })

      return { saleId: sale.id, saleNumber: sale.saleNumber, total, alreadyClosed: false }
    })

    // สัญญาณ SSE ให้ผังโต๊ะ/แจ้งเตือน/หน้าลูกค้า (จ่ายสำเร็จ) รู้ทันที — ทุกเส้นทางปิดบิล (พนักงาน/webhook/สลิป) ผ่านที่นี่
    if (!result.alreadyClosed) {
      publishStoreEvent(input.storeId, "payments")
      publishStoreEvent(input.storeId, "tables")
      publishStoreEvent(input.storeId, "bookings")
    }
    return { ok: true, ...result }
  } catch (error) {
    // ★ หน้าต่างแข่งกัน: คำขอที่ถือ reference เดียวกันชิงปิดบิลไปก่อนระหว่างที่คำขอนี้ทำงานอยู่
    //   โผล่ได้สองหน้า — ชน unique (P2002) หรืออ่าน session เจอว่า CLOSED ไปแล้ว (CloseAbort)
    //   ทั้งสองแบบคือ "จ่ายเงินก้อนเดียวกัน" จึงต้องตอบว่าสำเร็จ ไม่ใช่ล้มเหลว มิฉะนั้นธนาคาร retry ไม่รู้จบ
    //   เช็คด้วย reference เท่านั้น — ถ้าคนละ reference แปลว่าเก็บเงินสองก้อนจริง ต้องปล่อยให้ fail ให้เห็น
    if (input.paymentReference) {
      const existing = await db.sale.findUnique({
        where: { paymentReference: input.paymentReference },
        select: { id: true, saleNumber: true, total: true },
      })
      if (existing) {
        return {
          ok: true,
          saleId: existing.id,
          saleNumber: existing.saleNumber,
          total: toNumber(existing.total),
          alreadyClosed: true,
        }
      }
    }
    if (error instanceof CloseAbort) return { ok: false, error: error.reason }
    return { ok: false, error: "ปิดบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
