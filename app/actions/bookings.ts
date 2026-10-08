"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { requireSellingStore, storeErrorMessage, type StoreContext } from "@/lib/session"
import { requireStoreAccess } from "@/lib/permissions"
import { publishStoreEvent } from "@/lib/realtime"
import { assertSlotFree, assertWithinShift, BookingError, resolveBookingTarget } from "@/lib/booking"
import { buildOrderLines, OrderLineError } from "@/lib/order-lines"
import { findCustomerSession, openOrReuseSession, SessionError } from "@/lib/table-session"
import { businessDayTime, formatHhMm, minuteOfBusinessDay, parseHhMm } from "@/lib/day"
import {
  bookingCancelSchema,
  bookingCheckInSchema,
  bookingSchema,
  idSchema,
  firstIssueMessage,
  zodToFieldErrors,
} from "@/lib/validation"
import type { ActionResult } from "@/lib/types"
import type { BookingStatus, OrderItemStatus } from "@/generated/prisma/client"

/// การจองล่วงหน้าของร้านนวด (Phase 20b) — resource `SPA_BOOKINGS`
///
/// การจอง **ไม่สร้างบิลและไม่แตะเงิน** — มันคือการกันเวลาของพนักงาน (และห้อง ถ้าเลือกไว้) เท่านั้น
/// เงินเกิดตอน "เช็กอิน" ซึ่งเปิด TableSession + MobileOrder ด้วยเส้นทางเดิม (`openOrReuseSession` + `buildOrderLines`)
/// แล้วปิดบิลที่หน้าเดิมทุกประการ (กติกาข้อ 8) — ในไฟล์นี้ไม่มีทางปิดบิลใหม่
/// · ทุกกติกาว่าง/ไม่ว่าง อยู่ที่ `lib/booking.ts` ที่เดียว ห้ามเช็คเองในนี้

function revalidateBookingPages(storeId: string) {
  publishStoreEvent(storeId, "bookings")
  revalidatePath("/spa/bookings")
  revalidatePath("/spa/board")
}

/// เช็กอินแตะทั้งโต๊ะ/ออร์เดอร์/แจ้งเตือน จึงต้องส่งสัญญาณให้หน้าจออื่นด้วย (กติกาข้อ 12)
function revalidateCheckInPages(storeId: string) {
  revalidateBookingPages(storeId)
  publishStoreEvent(storeId, "orders")
  publishStoreEvent(storeId, "tables")
  publishStoreEvent(storeId, "notifications")
  revalidatePath("/mobile-order/tables")
  revalidatePath("/mobile-order/notifications")
  revalidatePath("/mobile-order/pos")
}

async function bookingBufferMinutes(storeId: string): Promise<number> {
  const settings = await forStore(storeId).storeSettings.findUnique({
    where: { storeId },
    select: { bookingBufferMinutes: true },
  })
  return settings?.bookingBufferMinutes ?? 0
}

/// สร้าง/แก้ไขการจอง — เวลาที่กรอกเป็นเวลาไทยเสมอ (แปลงที่ `businessDayTime` ที่เดียว)
export async function saveBooking(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const editing = Boolean(formData.get("id"))
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_BOOKINGS", editing ? "EDIT" : "ADD"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = bookingSchema.safeParse({
    id: formData.get("id") ?? undefined,
    customerName: formData.get("customerName"),
    customerPhone: formData.get("customerPhone") ?? undefined,
    menuItemId: formData.get("menuItemId"),
    therapistId: formData.get("therapistId"),
    tableId: formData.get("tableId") ?? undefined,
    bookingDate: formData.get("bookingDate"),
    startTime: formData.get("startTime"),
    note: formData.get("note") ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const data = parsed.data

  const startMinute = parseHhMm(data.startTime)
  if (startMinute === null) return { ok: false, error: "รูปแบบเวลาจองไม่ถูกต้อง", fieldErrors: { startTime: "เช่น 13:30" } }
  const startAt = businessDayTime(data.bookingDate, startMinute)

  const buffer = await bookingBufferMinutes(storeId)

  try {
    const saved = await db.$transaction(async (tx) => {
      // โปรแกรม/พนักงาน/ห้อง ต้องเป็นของร้านนี้และเข้ากันได้ (ทักษะ · ประเภทห้อง)
      const target = await resolveBookingTarget(tx, {
        menuItemId: data.menuItemId,
        therapistId: data.therapistId,
        tableId: data.tableId ?? null,
      })
      const endAt = new Date(startAt.getTime() + target.durationMinutes * 60_000)

      if (data.id) {
        const existing = await tx.booking.findUnique({ where: { id: data.id }, select: { id: true, status: true } })
        if (!existing) throw new BookingError("ไม่พบการจองที่ต้องการแก้")
        if (existing.status !== "BOOKED") throw new BookingError("การจองนี้เช็กอิน/ยกเลิกไปแล้ว แก้เวลาไม่ได้")
      }

      await assertWithinShift(tx, {
        therapistId: target.therapistId,
        therapistLabel: target.therapistLabel,
        startAt,
        endAt,
      })
      // ★ ด่านกันคิวชนกัน (advisory lock) — ต้องอยู่ในทรานแซคชันเดียวกับการเขียนเสมอ
      await assertSlotFree(tx, storeId, {
        bookingId: data.id,
        therapistId: target.therapistId,
        tableId: target.tableId,
        startAt,
        endAt,
        bufferMinutes: buffer,
        therapistLabel: target.therapistLabel,
        tableCode: target.tableCode,
      })

      const values = {
        customerName: data.customerName,
        customerPhone: data.customerPhone ?? null,
        menuItemId: target.menuItemId,
        durationMinutes: target.durationMinutes,
        therapistId: target.therapistId,
        tableId: target.tableId,
        startAt,
        endAt,
        note: data.note ?? null,
      }

      if (data.id) {
        await tx.booking.update({ where: { id: data.id }, data: values })
        return { id: data.id, target, endAt }
      }
      const created = await tx.booking.create({
        data: { ...values, storeId, createdById: ctx.user.id },
        select: { id: true },
      })
      return { id: created.id, target, endAt }
    })

    revalidateBookingPages(storeId)
    const range = `${formatHhMm(minuteOfBusinessDay(startAt))}–${formatHhMm(minuteOfBusinessDay(saved.endAt))} น.`
    return {
      ok: true,
      message: editing
        ? `แก้การจองของ ${data.customerName} เป็น ${range} แล้ว`
        : `จอง ${saved.target.menuItemName} ให้ ${data.customerName} ${range} กับ ${saved.target.therapistLabel} แล้ว`,
      data: { id: saved.id },
    }
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.reason }
    return { ok: false, error: "บันทึกการจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// ยกเลิกการจอง / บันทึกว่าไม่มาตามนัด — ทั้งคู่ปล่อยช่วงเวลาคืนให้จองใหม่ได้ทันที
async function closeBooking(formData: FormData, to: "CANCELLED" | "NO_SHOW"): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_BOOKINGS", "DELETE"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = bookingCancelSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") ?? undefined })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  // "ไม่มาตามนัด" ใช้ได้เฉพาะคิวที่ลูกค้ายังไม่มา (BOOKED) — เช็กอินแล้วแปลว่ามาแล้ว (2026-10-08 เจ้าของสั่ง)
  // "ยกเลิกคิว" ได้ถึงตอนเช็กอินแล้วแต่ยังไม่เริ่มนวด · เริ่มนวดแล้วปิดคิวด้วย "เสร็จแล้ว" หรือปิดบิลเท่านั้น
  const from: BookingStatus[] = to === "NO_SHOW" ? ["BOOKED"] : ["BOOKED", "CHECKED_IN"]

  try {
    const cancelledItem = await db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: parsed.data.id },
        select: { id: true, status: true, therapistId: true, menuItemId: true, tableSessionId: true },
      })
      if (!booking) throw new BookingError("ไม่พบการจองที่ต้องการ")

      // conditional update — กันกดยกเลิกพร้อมกับเช็กอิน/เริ่มนวด (แนวเดียวกับกติกาข้อ 7)
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: { in: from } },
        data: { status: to, cancelledAt: new Date(), cancelReason: parsed.data.reason ?? null },
      })
      if (updated.count === 0) {
        throw new BookingError(
          to === "NO_SHOW"
            ? "ลูกค้าเช็กอินแล้ว บันทึกว่าไม่มาตามนัดไม่ได้"
            : "เริ่มนวดไปแล้ว ยกเลิกคิวไม่ได้ — กด “เสร็จแล้ว” หรือปิดบิลที่หน้าห้องแทน",
        )
      }

      // เช็กอินแล้ว = มีรายการนวดในบิลห้อง → ยกเลิกรายการนั้นด้วย ไม่งั้นบิลคิดเงินโปรแกรมที่ไม่ได้นวด
      if (booking.status !== "CHECKED_IN" || !booking.tableSessionId) return false
      const item = await tx.mobileOrderItem.findFirst({
        where: {
          order: { storeId, tableSessionId: booking.tableSessionId },
          therapistId: booking.therapistId,
          menuItemId: booking.menuItemId,
          status: "AWAITING_KITCHEN",
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
      if (!item) return false
      const moved = await tx.mobileOrderItem.updateMany({
        where: { id: item.id, order: { storeId }, status: "AWAITING_KITCHEN" },
        data: { status: "CANCELLED", cancelReason: parsed.data.reason ?? "ยกเลิกคิวจอง" },
      })
      if (moved.count === 0) throw new BookingError("รายการนวดของคิวนี้เพิ่งเริ่มจากอีกเครื่องหนึ่ง ยกเลิกไม่ได้แล้ว")
      return true
    })

    if (cancelledItem) revalidateCheckInPages(storeId)
    else revalidateBookingPages(storeId)
    return {
      ok: true,
      message:
        to === "NO_SHOW"
          ? "บันทึกว่าลูกค้าไม่มาตามนัดแล้ว"
          : cancelledItem
            ? "ยกเลิกคิวและรายการนวดในบิลห้องแล้ว — ถ้าห้องไม่มีรายการอื่น ยกเลิกบิลได้ที่หน้าห้อง"
            : "ยกเลิกการจองแล้ว",
    }
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.reason }
    return { ok: false, error: "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

export async function cancelBooking(formData: FormData): Promise<ActionResult> {
  return closeBooking(formData, "CANCELLED")
}

export async function markBookingNoShow(formData: FormData): Promise<ActionResult> {
  return closeBooking(formData, "NO_SHOW")
}

export type CheckInResult = {
  bookingId: string
  sessionId: string
  tableId: string
  tableCode: string
  orderId: string
}

/// ลูกค้ามาถึง → เปิดห้อง + ส่งรายการบริการเข้าระบบ แล้วปิดบิลด้วยเส้นทางเดิม
///
/// **ขายใหม่** จึงต้องผ่าน `requireSellingStore()` ตามกติกาข้อ 5 (แพ็กเกจหมดอายุ = จองไว้ได้ แต่เช็กอินไม่ได้)
export async function checkInBooking(formData: FormData): Promise<ActionResult<CheckInResult>> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_BOOKINGS", "ADD"])
    await requireSellingStore()
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = bookingCheckInSchema.safeParse({ id: formData.get("id"), tableId: formData.get("tableId") })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  const buffer = await bookingBufferMinutes(storeId)

  try {
    const result = await db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: parsed.data.id },
        select: { id: true, status: true, menuItemId: true, therapistId: true, startAt: true, endAt: true, customerName: true, customerPhone: true },
      })
      if (!booking) throw new BookingError("ไม่พบการจองที่ต้องการ")
      if (booking.status !== "BOOKED") throw new BookingError("การจองนี้เช็กอินหรือถูกปิดไปแล้ว")

      // ★ ปิดประตูก่อนทำอย่างอื่น: กดเช็กอินพร้อมกันสองเครื่องต้องผ่านได้ใบเดียว ไม่งั้นได้ออร์เดอร์ซ้ำสองใบ
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, status: "BOOKED" },
        data: { status: "CHECKED_IN", checkedInAt: new Date(), tableId: parsed.data.tableId },
      })
      if (claimed.count === 0) throw new BookingError("การจองนี้เพิ่งถูกเช็กอินจากอีกเครื่องหนึ่ง")

      // ห้องที่เลือกตอนนี้ต้องเป็นห้องของร้าน ตรงประเภทบริการ และไม่ชนคิวห้องอื่น
      const target = await resolveBookingTarget(tx, {
        menuItemId: booking.menuItemId,
        therapistId: booking.therapistId,
        tableId: parsed.data.tableId,
      })
      await assertSlotFree(tx, storeId, {
        bookingId: booking.id,
        therapistId: target.therapistId,
        tableId: target.tableId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        bufferMinutes: buffer,
        therapistLabel: target.therapistLabel,
        tableCode: target.tableCode,
      })
      // ตรวจกะซ้ำตอนเช็กอิน (2026-09-24) — คิวที่จองไว้ก่อนบังคับกะ หรือกะถูกลบ/ตั้งหยุดหลังจอง ต้องไม่เข้าห้องได้เงียบ ๆ
      await assertWithinShift(tx, {
        therapistId: target.therapistId,
        therapistLabel: target.therapistLabel,
        startAt: booking.startAt,
        endAt: booking.endAt,
      })

      // 1 ลูกค้า = 1 บิล (2026-09-23): ห้องมีบิลของลูกค้าคนเดิมเปิดอยู่ → เข้าบิลนั้น · คนอื่น/ห้องว่าง → เปิดบิลใหม่ของลูกค้าคนนี้
      // เดิม reuse session ของห้องเสมอ ลูกค้าคนถัดไปในห้องเดียวกันจึงถูกรวมบิลกับคนก่อนที่ยังไม่จ่าย
      const sameCustomer = await findCustomerSession(tx, parsed.data.tableId, {
        name: booking.customerName,
        phone: booking.customerPhone,
      })
      const session = await openOrReuseSession(
        tx,
        storeId,
        sameCustomer
          ? { tableId: parsed.data.tableId, sessionId: sameCustomer }
          : { tableId: parsed.data.tableId, newCustomer: { label: booking.customerName } },
      )
      if (session.status === "AWAITING_BILL") {
        throw new BookingError(`บิลของคุณ${booking.customerName} ในห้อง ${session.tableCode} ขอเช็กบิลแล้ว — ปิดบิลนั้นก่อนแล้วค่อยเช็กอิน`)
      }

      // บรรทัดบริการผ่านตัวเดียวกับจอขาย — ราคา/ทักษะ/ตัวเลือกเสริมถูกตรวจซ้ำในทรานแซคชันนี้
      const rows = await buildOrderLines(
        tx,
        [{ menuItemId: booking.menuItemId, quantity: 1, optionIds: [], therapistId: booking.therapistId }],
        { requireTherapistForService: true },
      )

      const last = await tx.mobileOrder.findFirst({
        where: { tableSessionId: session.sessionId },
        orderBy: { orderNumber: "desc" },
        select: { orderNumber: true },
      })
      const order = await tx.mobileOrder.create({
        data: {
          storeId,
          tableSessionId: session.sessionId,
          orderNumber: (last?.orderNumber ?? 0) + 1,
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
        select: { id: true },
      })

      await tx.booking.update({ where: { id: booking.id }, data: { tableSessionId: session.sessionId } })
      await tx.table.update({ where: { id: session.tableId }, data: { status: "ORDERED" } })

      return {
        bookingId: booking.id,
        customerName: booking.customerName,
        sessionId: session.sessionId,
        tableId: session.tableId,
        tableCode: session.tableCode,
        orderId: order.id,
      }
    })

    revalidateCheckInPages(storeId)
    return {
      ok: true,
      message: `เช็กอิน ${result.customerName} เข้าห้อง ${result.tableCode} แล้ว`,
      data: {
        bookingId: result.bookingId,
        sessionId: result.sessionId,
        tableId: result.tableId,
        tableCode: result.tableCode,
        orderId: result.orderId,
      },
    }
  } catch (error) {
    // ทั้งสามตัวเก็บข้อความไทยพร้อมแสดงไว้ในตัวเองแล้ว
    if (error instanceof BookingError) return { ok: false, error: error.reason }
    if (error instanceof SessionError) return { ok: false, error: error.reason }
    if (error instanceof OrderLineError) return { ok: false, error: error.reason }
    return { ok: false, error: "เช็กอินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// เปลี่ยนสถานะคิวจากหน้าตารางจอง (2026-10-08) — "เริ่มนวด" / "เสร็จแล้ว" ไม่ต้องเดินไปหน้าห้อง
///
/// เดินบรรทัดบริการในบิล (MobileOrderItem) **และ** คิว (Booking) ในทรานแซคชันเดียว ผลจึงเหมือนกดจากหน้าห้องทุกอย่าง
/// (`startServiceItem`/`markItemServed` ใน orders.ts เลื่อนคิวตามบรรทัด · ที่นี่เลื่อนบรรทัดตามคิว — ปลายทางเดียวกัน)
/// · ทั้งสองฝั่งเป็น conditional update ตามสถานะต้นทาง (กติกาข้อ 7) — กดพร้อมกันสองเครื่องผ่านได้ครั้งเดียว
/// · บรรทัดของคิวหาจาก session + พนักงาน + โปรแกรม ที่เช็กอินสร้างไว้ (Booking ไม่ได้เก็บ id ของบรรทัด)
async function advanceBookingService(formData: FormData, to: "IN_SERVICE" | "DONE"): Promise<ActionResult> {
  let ctx: StoreContext
  try {
    ctx = await requireStoreAccess(["SPA_BOOKINGS", "EDIT"])
  } catch (error) {
    return { ok: false, error: storeErrorMessage(error) }
  }
  const storeId = ctx.storeId
  const db = forStore(storeId)

  const parsed = idSchema.safeParse({ id: formData.get("id") })
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) }

  const bookingFrom = to === "IN_SERVICE" ? "CHECKED_IN" : "IN_SERVICE"
  const itemFrom: OrderItemStatus[] = to === "IN_SERVICE" ? ["AWAITING_KITCHEN"] : ["COOKING", "READY"]
  const itemTo: OrderItemStatus = to === "IN_SERVICE" ? "COOKING" : "SERVED"

  try {
    const customerName = await db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: parsed.data.id },
        select: { id: true, status: true, customerName: true, therapistId: true, menuItemId: true, tableSessionId: true },
      })
      if (!booking) throw new BookingError("ไม่พบการจองที่ต้องการ")
      if (booking.status !== bookingFrom || !booking.tableSessionId) {
        throw new BookingError(
          to === "IN_SERVICE" ? "เริ่มนวดได้เฉพาะคิวที่เช็กอินแล้วและยังไม่เริ่ม" : "กดเสร็จได้เฉพาะคิวที่กำลังนวดอยู่",
        )
      }

      // ★ ปิดประตูที่คิวก่อน — กดพร้อมกันสองเครื่องต้องผ่านได้ครั้งเดียว
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, status: bookingFrom },
        data: { status: to },
      })
      if (claimed.count === 0) throw new BookingError("คิวนี้เพิ่งถูกเปลี่ยนสถานะจากอีกเครื่องหนึ่ง")

      // บรรทัดบริการของคิวนี้ — MobileOrderItem ไม่มี storeId ต้องกรองผ่าน order.storeId เอง (ดู transition ใน orders.ts)
      const item = await tx.mobileOrderItem.findFirst({
        where: {
          order: { storeId, tableSessionId: booking.tableSessionId },
          therapistId: booking.therapistId,
          menuItemId: booking.menuItemId,
          status: { in: itemFrom },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
      if (!item) {
        throw new BookingError(
          to === "IN_SERVICE"
            ? "ไม่พบรายการนวดของคิวนี้ในบิล (อาจถูกยกเลิกหรือเริ่มไปแล้ว) — ตรวจที่หน้าห้อง"
            : "ไม่พบรายการนวดที่กำลังทำของคิวนี้ในบิล — ตรวจที่หน้าห้อง",
        )
      }
      const moved = await tx.mobileOrderItem.updateMany({
        where: { id: item.id, order: { storeId }, status: { in: itemFrom } },
        data: { status: itemTo },
      })
      if (moved.count === 0) throw new BookingError("รายการนวดของคิวนี้เพิ่งถูกเปลี่ยนสถานะจากอีกเครื่องหนึ่ง")

      return booking.customerName
    })

    revalidateCheckInPages(storeId)
    return { ok: true, message: to === "IN_SERVICE" ? `เริ่มนวดคุณ${customerName}แล้ว` : `คุณ${customerName} นวดเสร็จแล้ว` }
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.reason }
    return { ok: false, error: "เปลี่ยนสถานะคิวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}

/// เช็กอินแล้ว → กำลังนวด
export async function startBookingService(formData: FormData): Promise<ActionResult> {
  return advanceBookingService(formData, "IN_SERVICE")
}

/// กำลังนวด → เสร็จแล้ว
export async function finishBookingService(formData: FormData): Promise<ActionResult> {
  return advanceBookingService(formData, "DONE")
}
