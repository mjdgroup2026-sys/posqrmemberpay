"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { requireSellingStore, storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { publishStoreEvent } from "@/lib/realtime"
import { buildOrderLines, OrderLineError, type OrderLine } from "@/lib/order-lines"
import { openOrReuseSession, SessionError } from "@/lib/table-session"
import { printKitchenTicket, isPrinterConfigured } from "@/lib/kitchen-printer"
import { staffTableOrderSchema, parseCartJson, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { ActionResult } from "@/lib/types"

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
    items: parseCartJson(formData.get("items")),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { tableId, items } = parsed.data

  try {
    const created = await db.$transaction(async (tx) => {
      const session = await openOrReuseSession(tx, storeId, { tableId })

      // โต๊ะที่ลูกค้าขอเช็กบิลแล้ว สั่งเพิ่มไม่ได้ — กติกาเดียวกับฝั่งลูกค้า (ยอดถูกล็อกไว้รอจ่าย)
      if (session.status === "AWAITING_BILL") {
        throw new StaffOrderAbort(
          `โต๊ะ ${session.tableCode} ขอเช็กบิลแล้ว สั่งเพิ่มไม่ได้ — ปิดบิลก่อนแล้วเปิดโต๊ะใหม่`,
        )
      }

      const rows = await buildOrderLines(tx, items)

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

  const printed = await printKitchenTicket({
    tableCode,
    orderNumber: order.orderNumber,
    submittedAt: order.submittedAt,
    items: rows.map((row) => ({
      quantity: row.quantity,
      name: row.menuItemName,
      options: row.options.map((o) => o.optionName),
      note: row.note,
    })),
  })
  if (printed) {
    await db.mobileOrder.update({ where: { id: order.id }, data: { printedAt: new Date() } })
  }
  return printed
}
