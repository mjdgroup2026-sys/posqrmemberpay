"use server"

import { revalidatePath } from "next/cache"
import { forStore, type StoreTx } from "@/lib/db"
import { findStoreByQrToken } from "@/lib/store-resolve"
import { isPlanActive } from "@/lib/subscription"
import { toNumber } from "@/lib/format"
import { printKitchenTicket, isPrinterConfigured } from "@/lib/kitchen-printer"
import {
  submitOrderSchema,
  callStaffSchema,
  qrTokenSchema,
  parseCartJson,
  firstIssueMessage,
  zodToFieldErrors,
} from "@/lib/validation"
import type { ActionResult, FieldErrors } from "@/lib/types"

/// Action ฝั่งลูกค้าทั้งหมดในไฟล์นี้ **ไม่เรียก requireUser()** โดยตั้งใจ —
/// ลูกค้าที่สแกน QR ไม่มีบัญชีในระบบ ตัวระบุตัวตนคือ qrToken ที่เดาไม่ได้ (32 อักขระสุ่ม)
/// ทุก action จึงต้องตรวจ token → QR ที่ ACTIVE → session ที่ยังเปิดอยู่ ในทรานแซคชันเดียวกับการเขียนเสมอ

class CustomerAbort extends Error {
  constructor(readonly failure: { error: string; fieldErrors?: FieldErrors }) {
    super("CUSTOMER_ABORT")
  }
}

/// ร้านของลูกค้าคนนี้ = ร้านเจ้าของ qrToken (Phase 13) — ฝั่งลูกค้าไม่มี session/cookie มีแค่ token ใน URL
/// mustBeSelling (Phase 14b): การสั่งอาหารใหม่ต้องมีแพ็กเกจที่ยังไม่หมดอายุ — แต่เรียกพนักงาน/เช็กบิล/จ่าย
/// ของโต๊ะที่เปิดอยู่แล้วต้องทำได้ต่อ ไม่งั้นลูกค้าที่กินอยู่จะปิดบิลไม่ได้
async function resolveCustomerStore(qrToken: string, mustBeSelling = false): Promise<string> {
  const store = await findStoreByQrToken(qrToken)
  if (!store) throw new CustomerAbort({ error: "ไม่พบ QR Code นี้ในระบบ กรุณาแจ้งพนักงาน" })
  if (store.status === "SUSPENDED") throw new CustomerAbort({ error: "ร้านนี้ปิดรับออเดอร์ชั่วคราว กรุณาแจ้งพนักงาน" })
  if (mustBeSelling && !isPlanActive(new Date(), store.planExpiresAt)) {
    throw new CustomerAbort({ error: "ร้านนี้ปิดรับออเดอร์ชั่วคราว กรุณาแจ้งพนักงาน" })
  }
  return store.storeId
}

async function requireLiveSession(tx: StoreTx, qrToken: string) {
  const qr = await tx.qRCode.findUnique({
    where: { token: qrToken },
    select: { id: true, status: true, tableId: true, table: { select: { primaryTableId: true } } },
  })
  if (!qr) throw new CustomerAbort({ error: "ไม่พบ QR Code นี้ในระบบ กรุณาแจ้งพนักงาน" })
  if (qr.status === "INVALIDATED") {
    throw new CustomerAbort({ error: "QR Code นี้ใช้ไม่ได้แล้ว กรุณาแจ้งพนักงานให้เปิดโต๊ะใหม่" })
  }

  const tableId = qr.table.primaryTableId ?? qr.tableId
  const session = await tx.tableSession.findFirst({
    where: { tableId, status: { in: ["OPEN", "AWAITING_BILL"] } },
    orderBy: { openedAt: "desc" },
    select: { id: true, status: true, tableId: true },
  })
  if (!session) throw new CustomerAbort({ error: "โต๊ะนี้ยังไม่ได้เปิดใช้งาน กรุณาสแกน QR อีกครั้งหรือแจ้งพนักงาน" })

  return session
}

function revalidateCustomerPages() {
  revalidatePath("/mobile-order/tables")
  revalidatePath("/mobile-order/kitchen")
  revalidatePath("/mobile-order/notifications")
}

export type SubmitOrderResult = { orderId: string; orderNumber: number; printed: boolean }

/// ลูกค้ากด "ยืนยันออร์เดอร์" — สร้าง MobileOrder รอบใหม่ในเซสชันเดิมได้เรื่อย ๆ (ปุ่ม "สั่งเพิ่ม")
export async function submitOrder(formData: FormData): Promise<ActionResult<SubmitOrderResult>> {
  const parsed = submitOrderSchema.safeParse({
    qrToken: formData.get("qrToken") ?? "",
    items: parseCartJson(formData.get("items")),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { qrToken, items } = parsed.data

  try {
    const storeId = await resolveCustomerStore(qrToken, true)
    const db = forStore(storeId)
    const created = await db.$transaction(async (tx) => {
      const session = await requireLiveSession(tx, qrToken)
      if (session.status === "AWAITING_BILL") {
        throw new CustomerAbort({ error: "โต๊ะนี้ขอเช็กบิลแล้ว สั่งอาหารเพิ่มไม่ได้ กรุณาแจ้งพนักงาน" })
      }

      const menuItems = await tx.menuItem.findMany({
        where: { id: { in: items.map((i) => i.menuItemId) }, isActive: true },
        include: { modifierGroups: { include: { options: true } } },
      })
      const menuById = new Map(menuItems.map((m) => [m.id, m]))

      const rows = items.map((line) => {
        const menuItem = menuById.get(line.menuItemId)
        if (!menuItem) throw new CustomerAbort({ error: "มีเมนูบางรายการปิดขายไปแล้ว กรุณาตรวจตะกร้าอีกครั้ง" })

        const optionById = new Map(
          menuItem.modifierGroups.flatMap((group) =>
            group.options.map((option) => [option.id, { option, group }] as const),
          ),
        )

        const chosen = line.optionIds.map((id) => {
          const found = optionById.get(id)
          if (!found) throw new CustomerAbort({ error: `ตัวเลือกของ ${menuItem.name} ไม่ถูกต้อง กรุณาเลือกใหม่` })
          return found
        })

        // กลุ่มที่บังคับเลือกต้องมีอย่างน้อย 1 ตัวเลือกเสมอ — ตรวจซ้ำฝั่ง server ไม่เชื่อ UI
        for (const group of menuItem.modifierGroups) {
          if (!group.required) continue
          const picked = chosen.filter((c) => c.group.id === group.id)
          if (picked.length === 0) {
            throw new CustomerAbort({ error: `กรุณาเลือก "${group.name}" ของ ${menuItem.name}` })
          }
          if (group.selectionType === "SINGLE" && picked.length > 1) {
            throw new CustomerAbort({ error: `"${group.name}" ของ ${menuItem.name} เลือกได้อย่างเดียว` })
          }
        }

        const basePrice = toNumber(menuItem.price)
        const extra = chosen.reduce((sum, c) => sum + toNumber(c.option.priceDelta), 0)
        const unitPrice = Math.round((basePrice + extra + Number.EPSILON) * 100) / 100

        return {
          menuItemId: menuItem.id,
          menuItemName: menuItem.name,
          quantity: line.quantity,
          unitPrice,
          note: line.note ?? null,
          options: chosen.map((c) => ({
            groupName: c.group.name,
            optionName: c.option.name,
            priceDelta: toNumber(c.option.priceDelta),
          })),
        }
      })

      // เลขรอบสั่งต่อ session — unique (tableSessionId, orderNumber) เป็นด่านจริงถ้ากดยืนยันซ้อนกัน
      const last = await tx.mobileOrder.findFirst({
        where: { tableSessionId: session.id },
        orderBy: { orderNumber: "desc" },
        select: { orderNumber: true },
      })
      const orderNumber = (last?.orderNumber ?? 0) + 1

      const order = await tx.mobileOrder.create({
        data: {
          storeId,
          tableSessionId: session.id,
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

      return { order, rows, tableId: session.tableId }
    })

    // พิมพ์ทิกเก็ตหลัง commit — พิมพ์ไม่ผ่านต้องไม่ทำให้ออร์เดอร์ของลูกค้าหาย
    let printed = false
    if (isPrinterConfigured()) {
      const table = await db.table.findUnique({
        where: { id: created.tableId },
        select: { code: true },
      })
      printed = await printKitchenTicket({
        tableCode: table?.code ?? "-",
        orderNumber: created.order.orderNumber,
        submittedAt: created.order.submittedAt,
        items: created.rows.map((row) => ({
          quantity: row.quantity,
          name: row.menuItemName,
          options: row.options.map((o) => o.optionName),
          note: row.note,
        })),
      })
      if (printed) {
        await db.mobileOrder.update({
          where: { id: created.order.id },
          data: { printedAt: new Date() },
        })
      }
    }

    revalidateCustomerPages()
    return {
      ok: true,
      message: `ส่งออร์เดอร์ที่ ${created.order.orderNumber} เข้าครัวเรียบร้อยแล้ว`,
      data: { orderId: created.order.id, orderNumber: created.order.orderNumber, printed },
    }
  } catch (error) {
    if (error instanceof CustomerAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "ส่งออร์เดอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ลูกค้ากด "เรียกพนักงาน" (F15)
export async function callStaff(formData: FormData): Promise<ActionResult> {
  const parsed = callStaffSchema.safeParse({
    qrToken: formData.get("qrToken") ?? "",
    reason: formData.get("reason") ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  try {
    const storeId = await resolveCustomerStore(parsed.data.qrToken)
    await forStore(storeId).$transaction(async (tx) => {
      const session = await requireLiveSession(tx, parsed.data.qrToken)

      // กันกดรัว ๆ — ถ้ายังมีใบที่พนักงานไม่ได้กดรับทราบ ไม่ต้องสร้างใบใหม่ซ้ำ
      const pending = await tx.notification.findFirst({
        where: { tableSessionId: session.id, type: "CALL_STAFF", status: "PENDING" },
        select: { id: true },
      })
      if (pending) {
        await tx.notification.update({
          where: { id: pending.id },
          data: { reason: parsed.data.reason ?? null, createdAt: new Date() },
        })
        return
      }

      await tx.notification.create({
        data: { storeId, tableSessionId: session.id, type: "CALL_STAFF", reason: parsed.data.reason ?? null },
      })
    })

    revalidateCustomerPages()
    return { ok: true, message: "แจ้งพนักงานแล้ว กรุณารอสักครู่" }
  } catch (error) {
    if (error instanceof CustomerAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "เรียกพนักงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ลูกค้ากด "เช็กบิล" (F16) — โต๊ะขึ้นสถานะรอเช็กบิลทั้งฝั่ง session และผังโต๊ะ
export async function requestBill(formData: FormData): Promise<ActionResult<{ total: number }>> {
  const parsed = qrTokenSchema.safeParse({ qrToken: formData.get("qrToken") ?? "" })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  try {
    const storeId = await resolveCustomerStore(parsed.data.qrToken)
    const total = await forStore(storeId).$transaction(async (tx) => {
      const session = await requireLiveSession(tx, parsed.data.qrToken)

      const items = await tx.mobileOrderItem.findMany({
        where: { order: { tableSessionId: session.id }, status: { not: "CANCELLED" } },
        select: { quantity: true, unitPrice: true },
      })
      const sum = items.reduce((acc, item) => acc + toNumber(item.unitPrice) * item.quantity, 0)

      await tx.tableSession.updateMany({
        where: { id: session.id, status: "OPEN" },
        data: { status: "AWAITING_BILL" },
      })
      await tx.table.update({ where: { id: session.tableId }, data: { status: "AWAITING_BILL" } })

      const pending = await tx.notification.findFirst({
        where: { tableSessionId: session.id, type: "CHECK_BILL", status: "PENDING" },
        select: { id: true },
      })
      if (!pending) {
        await tx.notification.create({ data: { storeId, tableSessionId: session.id, type: "CHECK_BILL" } })
      }

      return Math.round((sum + Number.EPSILON) * 100) / 100
    })

    revalidateCustomerPages()
    return { ok: true, message: "แจ้งพนักงานเช็กบิลแล้ว", data: { total } }
  } catch (error) {
    if (error instanceof CustomerAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "เช็กบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
