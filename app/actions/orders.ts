"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { publishStoreEvent } from "@/lib/realtime"
import { orderTicketLabel } from "@/lib/order-label"
import { idSchema, cancelOrderItemSchema, firstIssueMessage, zodToFieldErrors } from "@/lib/validation"
import type { OrderItemStatus } from "@/generated/prisma/client"
import { isPrinterConfigured, printKitchenTicket } from "@/lib/kitchen-printer"
import type { ActionResult } from "@/lib/types"


/// ดึงชื่อ modifier ออกจาก JSON snapshot สำหรับพิมพ์ทิกเก็ต
function parseOptionNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) =>
    typeof entry === "object" && entry !== null && typeof (entry as { optionName?: unknown }).optionName === "string"
      ? [(entry as { optionName: string }).optionName]
      : [],
  )
}

const STATUS_LABEL: Record<OrderItemStatus, string> = {
  AWAITING_KITCHEN: "รอครัวรับ",
  COOKING: "กำลังปรุง",
  READY: "พร้อมเสิร์ฟ",
  SERVED: "เสิร์ฟแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
}

/// revalidate + ส่งสัญญาณ SSE (Phase 8 realtime) — เรียกหลังเขียน DB สำเร็จเท่านั้น
function revalidateOrderPages(storeId: string) {
  publishStoreEvent(storeId, "orders")
  publishStoreEvent(storeId, "tables")
  revalidatePath("/mobile-order/tables")
  revalidatePath("/mobile-order/kitchen")
  revalidatePath("/mobile-order/notifications")
}

async function hasKDS(storeId: string): Promise<boolean> {
  const settings = await forStore(storeId).storeSettings.findUnique({
    where: { storeId },
    select: { hasKDS: true },
  })
  return settings?.hasKDS ?? false
}

/// เปลี่ยนสถานะรายการอาหารแบบ conditional update (กติกาข้อ 7)
///
/// ★ ทุกการเปลี่ยนสถานะต้องระบุสถานะต้นทางใน `where` เสมอ ห้าม read-then-write —
///   ป้องกัน race ระหว่างครัวกด "เริ่มทำ" กับพนักงานกด "ยกเลิกรายการ" พร้อมกัน
/// ⚠️ MobileOrderItem ไม่มี storeId (เป็นตารางลูก) — forStore() กรองให้ไม่ได้ ต้องกรองผ่าน `order.storeId` เอง
///   ไม่งั้นพนักงานร้าน A ส่ง id ของรายการร้าน B มาเปลี่ยนสถานะได้
async function transition(
  storeId: string,
  itemId: string,
  from: OrderItemStatus[],
  to: OrderItemStatus,
  extra: Record<string, unknown> = {},
): Promise<ActionResult> {
  const db = forStore(storeId)
  const item = await db.mobileOrderItem.findFirst({
    where: { id: itemId, order: { storeId } },
    select: { id: true, status: true, menuItem: { select: { name: true } } },
  })
  if (!item) return { ok: false, error: "ไม่พบรายการอาหารนี้" }

  const updated = await db.mobileOrderItem.updateMany({
    where: { id: itemId, order: { storeId }, status: { in: from } },
    data: { status: to, ...extra },
  })

  if (updated.count === 0) {
    const current = await db.mobileOrderItem.findFirst({
      where: { id: itemId, order: { storeId } },
      select: { status: true },
    })
    return {
      ok: false,
      error: `เปลี่ยนสถานะ ${item.menuItem.name} ไม่ได้ — ตอนนี้เป็น "${STATUS_LABEL[current?.status ?? "CANCELLED"]}" แล้ว`,
    }
  }

  revalidateOrderPages(storeId)
  return { ok: true, message: `${item.menuItem.name} — ${STATUS_LABEL[to]}` }
}

/// ครัวกด "เริ่มปรุง" บน KDS
export async function startCookingItem(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_KITCHEN", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  if (!(await hasKDS(storeId))) {
    return { ok: false, error: "ร้านนี้ปิดการใช้งาน KDS อยู่ — ให้พนักงานกด “เสิร์ฟอาหารแล้ว” ที่หน้าโต๊ะแทน" }
  }

  return transition(storeId, parsed.data.id, ["AWAITING_KITCHEN"], "COOKING")
}

/// ครัวกด "ทำเสร็จแล้ว" บน KDS
export async function markItemReady(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_KITCHEN", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  return transition(storeId, parsed.data.id, ["COOKING"], "READY")
}

/// "เสิร์ฟอาหารแล้ว" — ร้านที่มี KDS กดจาก READY, ร้านที่ไม่มี KDS ข้ามจาก AWAITING_KITCHEN ตรงมา SERVED
export async function markItemServed(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_KITCHEN", "EDIT"], ["MO_TABLES", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  const from: OrderItemStatus[] = (await hasKDS(storeId))
    ? ["READY"]
    : ["AWAITING_KITCHEN", "COOKING", "READY"]

  return transition(storeId, parsed.data.id, from, "SERVED")
}

/// ยกเลิกรายการอาหารทีละรายการ — อนุญาตเฉพาะตอนยังเป็น AWAITING_KITCHEN เท่านั้น (กติกาข้อ 7)
export async function cancelOrderItem(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_TABLES", "DELETE"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const user = ctx.user
  const storeId = ctx.storeId

  const parsed = cancelOrderItemSchema.safeParse({
    id: formData.get("id") ?? "",
    reason: formData.get("reason") ?? "",
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  return transition(storeId, parsed.data.id, ["AWAITING_KITCHEN"], "CANCELLED", {
    cancelledAt: new Date(),
    cancelledById: user.id,
    cancelReason: parsed.data.reason,
  })
}

/// เปลี่ยนสถานะทั้งทิกเก็ตในครั้งเดียว (ปุ่มบน KDS เป็นระดับใบสั่ง ไม่ใช่รายรายการ)
/// ยังเป็น conditional update เหมือนเดิม — รายการที่สถานะเปลี่ยนไปแล้วจะไม่ถูกแตะ
async function transitionOrder(
  storeId: string,
  orderId: string,
  from: OrderItemStatus[],
  to: OrderItemStatus,
): Promise<ActionResult> {
  const updated = await forStore(storeId).mobileOrderItem.updateMany({
    where: { mobileOrderId: orderId, order: { storeId }, status: { in: from } },
    data: { status: to },
  })

  if (updated.count === 0) {
    return { ok: false, error: "รายการในทิกเก็ตนี้ถูกเปลี่ยนสถานะไปแล้ว" }
  }

  revalidateOrderPages(storeId)
  return { ok: true, message: `อัปเดต ${updated.count} รายการเป็น "${STATUS_LABEL[to]}" แล้ว` }
}

export async function startCookingOrder(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_KITCHEN", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  if (!(await hasKDS(storeId))) {
    return { ok: false, error: "ร้านนี้ปิดการใช้งาน KDS อยู่ — ให้พนักงานกด “เสิร์ฟอาหารแล้ว” ที่หน้าโต๊ะแทน" }
  }

  return transitionOrder(storeId, parsed.data.id, ["AWAITING_KITCHEN"], "COOKING")
}

export async function markOrderReady(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_KITCHEN", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  return transitionOrder(storeId, parsed.data.id, ["COOKING"], "READY")
}

export async function markOrderServed(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_KITCHEN", "EDIT"], ["MO_TABLES", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  const from: OrderItemStatus[] = (await hasKDS(storeId))
    ? ["READY"]
    : ["AWAITING_KITCHEN", "COOKING", "READY"]

  return transitionOrder(storeId, parsed.data.id, from, "SERVED")
}

/// พิมพ์ทิกเก็ตครัวซ้ำ — ใช้ตอนกระดาษหมด/เครื่องพิมพ์หลุด แล้วทิกเก็ตรอบแรกไม่ออก
/// การพิมพ์อยู่นอกทรานแซคชันโดยตั้งใจ: พิมพ์ไม่ผ่านต้องไม่ทำให้ข้อมูลออร์เดอร์เสียหาย
export async function reprintKitchenTicket(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_KITCHEN", "EDIT"], ["MO_TABLES", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  const order = await db.mobileOrder.findUnique({
    where: { id: parsed.data.id },
    include: {
      session: { select: { table: { select: { code: true } } } },
      items: {
        where: { status: { not: "CANCELLED" } },
        include: { menuItem: { select: { name: true } } },
      },
    },
  })
  if (!order) return { ok: false, error: "ไม่พบออร์เดอร์นี้" }

  if (!isPrinterConfigured()) {
    return {
      ok: false,
      error: "ยังไม่ได้ต่อเครื่องพิมพ์ครัว — ใช้ปุ่ม “ทิกเก็ต PDF” พิมพ์ผ่านเบราว์เซอร์แทนได้เลย",
    }
  }

  const printed = await printKitchenTicket({
    tableCode: orderTicketLabel({
      orderType: order.orderType,
      tableCode: order.session?.table.code ?? null,
      orderNumber: order.orderNumber,
      customerLabel: order.customerLabel,
    }),
    orderNumber: order.orderNumber,
    submittedAt: order.submittedAt,
    items: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.menuItem.name,
      options: parseOptionNames(item.selectedOptionsSnapshot),
      note: item.note,
    })),
  })

  if (!printed) {
    return { ok: false, error: "ส่งงานพิมพ์ไม่สำเร็จ — ตรวจว่าเครื่องพิมพ์เปิดอยู่และอยู่ในเครือข่ายเดียวกัน" }
  }

  await db.mobileOrder.update({
    where: { id: order.id },
    data: { printedAt: new Date() },
  })

  revalidateOrderPages(storeId)
  return { ok: true, message: `พิมพ์ทิกเก็ตออร์เดอร์ที่ ${order.orderNumber} ซ้ำเรียบร้อยแล้ว` }
}

/// บันทึกว่าทิกเก็ตถูกพิมพ์แล้ว — เรียกจากหน้า `/tickets/[orderId]` ตอนผู้ใช้กดพิมพ์/บันทึก PDF
///
/// แยกจาก `reprintKitchenTicket` เพราะเส้นทาง PDF ไม่ได้ส่งงานไปเครื่องพิมพ์เอง
/// เบราว์เซอร์เป็นคนพิมพ์ ฝั่ง server จึงมีหน้าที่แค่ประทับเวลาไว้ให้ผังโต๊ะ/KDS เห็นตรงกัน
export async function markTicketPrinted(formData: FormData): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["MO_KITCHEN", "EDIT"], ["MO_TABLES", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  // ออร์เดอร์ต้องเป็นของร้านนี้ — forStore() กรองให้ id ของร้านอื่นได้ null (ไม่ใช่ "เคยพิมพ์ไปแล้ว")
  const order = await db.mobileOrder.findUnique({ where: { id: parsed.data.id }, select: { id: true } })
  if (!order) return { ok: false, error: "ไม่พบออร์เดอร์นี้" }

  // ประทับเฉพาะครั้งแรก — เปิดหน้าเดิมซ้ำไม่ควรเลื่อนเวลา "พิมพ์ครั้งแรก" ให้ใหม่เรื่อย ๆ
  const stamped = await db.mobileOrder.updateMany({
    where: { id: parsed.data.id, printedAt: null },
    data: { printedAt: new Date() },
  })

  revalidateOrderPages(storeId)
  return {
    ok: true,
    message: stamped.count > 0 ? "บันทึกว่าพิมพ์ทิกเก็ตแล้ว" : "ทิกเก็ตนี้เคยพิมพ์ไปแล้ว",
  }
}
