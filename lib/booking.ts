import "server-only"
import type { StoreTx } from "@/lib/db"
import type { RawClient } from "@/lib/sale-number"
import type { BookingStatus } from "@/generated/prisma/client"
import { businessDayKey, dateOnlyFromKey, formatHhMm, minuteOfBusinessDay } from "@/lib/day"

/// การจองล่วงหน้าของร้านนวด (Phase 20b) — **ตรรกะเดียวที่ตัดสินว่า "ช่วงเวลานี้จองได้ไหม"**
///
/// ห้ามลอกไปเขียนซ้ำในหน้า/action ใด ด้วยเหตุผลเดียวกับ `openOrReuseSession()` และ `buildOrderLines()`:
/// ฟอร์มจอง · การเลื่อนเวลา · การเช็กอิน ต้องตัดสินด้วยกติกาชุดเดียวกันทุกทาง ไม่งั้นจะมีทางหนึ่งที่จองซ้อนได้
///
/// ★ **กันจองซ้อนแบบ concurrent ด้วย advisory lock** (กติกาข้อ 4 แนวเดียวกับเลขบิล/เพดานโต๊ะ):
///   "อ่านว่าว่าง → เขียน" สองคำขอที่วิ่งพร้อมกันจะอ่านเห็นว่างทั้งคู่แล้วจองทับกันได้จริง —
///   จึงต้องจับ lock ต่อพนักงาน (และต่อห้อง ถ้าระบุ) ก่อนตรวจเสมอ ใน**ทรานแซคชันเดียวกับการเขียน**
///   lock ปล่อยเองตอน commit/rollback · ไม่ใช้ EXCLUDE constraint เพราะ Prisma ไม่รู้จัก (จะ drift ทุก migrate diff)
/// ★ ลำดับการจับ lock ต้องคงที่เสมอ (พนักงานก่อน แล้วค่อยห้อง) ไม่งั้นสองคำขอที่สลับคู่กันจะ deadlock

/// namespace ของ lock — แยกจาก 720_001 (เลขบิล) และ 720_002 (เพดานโต๊ะ)
const BOOKING_THERAPIST_LOCK_NAMESPACE = 720_003
const BOOKING_ROOM_LOCK_NAMESPACE = 720_004

/// สถานะที่ยัง "กันเวลา" อยู่ — ยกเลิก/ไม่มา/เสร็จแล้ว คืนช่วงเวลาให้จองใหม่ได้ทันที
export const ACTIVE_BOOKING_STATUS = ["BOOKED", "CHECKED_IN", "IN_SERVICE"] as const

/// ระยะเวลาบริการที่ยอมรับ (นาที) — ตรงกับขอบเขตของ MenuItem.durationMinutes
export const MIN_SERVICE_MINUTES = 5
export const MAX_SERVICE_MINUTES = 600

/// ข้อผิดพลาดที่ผู้ใช้ต้องเห็นข้อความไทยตรง ๆ — ผู้เรียกจับแล้วคืนเป็น ActionResult ของตัวเอง
export class BookingError extends Error {
  constructor(readonly reason: string) {
    super("BOOKING_ERROR")
  }
}

export type BookingTarget = {
  menuItemId: string
  menuItemName: string
  durationMinutes: number
  /// ประเภทบริการของโปรแกรม (null = ไม่ระบุ — พนักงานคนไหน/ห้องไหนก็ได้)
  stationId: string | null
  stationName: string | null
  therapistId: string
  therapistLabel: string
  tableId: string | null
  tableCode: string | null
}

type TargetInput = { menuItemId: string; therapistId: string; tableId?: string | null }

/// ตรวจว่าโปรแกรม/พนักงาน/ห้องที่ผู้ใช้ส่งมาเป็นของร้านนี้และเข้ากันได้ (กติกาข้อ 5 — FK จากฟอร์มต้องเช็คเอง)
///
/// อ่านทุกอย่างใต้ `forStore()` ในทรานแซคชันเดียวกับการเขียน id ของร้านอื่นจึงหาไม่เจอ = ปฏิเสธ
export async function resolveBookingTarget(tx: StoreTx, input: TargetInput): Promise<BookingTarget> {
  const menuItem = await tx.menuItem.findUnique({
    where: { id: input.menuItemId },
    select: { id: true, name: true, itemType: true, durationMinutes: true, isActive: true, stationId: true, station: { select: { name: true } } },
  })
  if (!menuItem) throw new BookingError("ไม่พบโปรแกรมนวดที่เลือก")
  if (menuItem.itemType !== "SERVICE") throw new BookingError(`${menuItem.name} ไม่ใช่โปรแกรมนวด จองล่วงหน้าไม่ได้`)
  if (!menuItem.isActive) throw new BookingError(`${menuItem.name} ปิดขายอยู่ เลือกโปรแกรมอื่นก่อน`)
  const duration = menuItem.durationMinutes ?? 0
  if (duration < MIN_SERVICE_MINUTES || duration > MAX_SERVICE_MINUTES) {
    throw new BookingError(`${menuItem.name} ยังไม่ได้ตั้งระยะเวลาบริการ — แก้ที่หน้าจัดการเมนูก่อนจึงจะจองได้`)
  }

  const therapist = await tx.therapist.findUnique({
    where: { id: input.therapistId },
    select: { id: true, code: true, name: true, nickname: true, isActive: true, skills: { select: { id: true } } },
  })
  if (!therapist) throw new BookingError("ไม่พบพนักงานนวดที่เลือก")
  if (!therapist.isActive) throw new BookingError(`พนักงาน ${therapist.code} ปิดใช้งานอยู่ เลือกคนอื่นก่อน`)
  if (menuItem.stationId && !therapist.skills.some((s) => s.id === menuItem.stationId)) {
    throw new BookingError(`พนักงาน ${therapist.code} ไม่มีทักษะ "${menuItem.station?.name ?? ""}" สำหรับ ${menuItem.name}`)
  }

  let table: { id: string; code: string } | null = null
  if (input.tableId) {
    const found = await tx.table.findUnique({
      where: { id: input.tableId },
      select: { id: true, code: true, kind: true, stationId: true, primaryTableId: true },
    })
    if (!found) throw new BookingError("ไม่พบห้องที่เลือก")
    if (found.kind !== "ROOM") throw new BookingError(`${found.code} เป็นโต๊ะอาหาร ไม่ใช่ห้องนวด`)
    if (found.primaryTableId) throw new BookingError(`ห้อง ${found.code} ถูกรวมเข้ากับห้องอื่นอยู่ เลือกห้องอื่นก่อน`)
    // ห้องที่ระบุประเภทไว้ต้องตรงกับประเภทบริการของโปรแกรม (ห้องไม่ระบุประเภท = ใช้ได้ทุกโปรแกรม)
    if (found.stationId && menuItem.stationId && found.stationId !== menuItem.stationId) {
      throw new BookingError(`ห้อง ${found.code} ไม่ใช่ห้องสำหรับ "${menuItem.station?.name ?? ""}"`)
    }
    table = { id: found.id, code: found.code }
  }

  return {
    menuItemId: menuItem.id,
    menuItemName: menuItem.name,
    durationMinutes: duration,
    stationId: menuItem.stationId,
    stationName: menuItem.station?.name ?? null,
    therapistId: therapist.id,
    therapistLabel: `${therapist.code} ${therapist.nickname ?? therapist.name}`,
    tableId: table?.id ?? null,
    tableCode: table?.code ?? null,
  }
}

export type SlotInput = {
  /// ใบที่กำลังแก้ — ไม่ต้องนับตัวเองว่าชนกับตัวเอง
  bookingId?: string
  therapistId: string
  tableId?: string | null
  startAt: Date
  endAt: Date
  /// ช่วงพักระหว่างคิว (StoreSettings.bookingBufferMinutes)
  bufferMinutes: number
  therapistLabel: string
  tableCode?: string | null
}

type LockClient = RawClient

/// จับ lock ของพนักงาน (และห้อง) แล้วตรวจว่าช่วงเวลาไม่ชนกับคิวที่มีอยู่ — **เรียกในทรานแซคชันเดียวกับการเขียนเสมอ**
///
/// สองคิวถือว่าชนกันเมื่อช่วงเวลาซ้อนกันหลังขยายด้วย buffer ทั้งสองข้าง:
///   มีอยู่.start < ใหม่.end + buffer  และ  มีอยู่.end + buffer > ใหม่.start
export async function assertSlotFree(tx: StoreTx, storeId: string, input: SlotInput): Promise<void> {
  if (input.endAt <= input.startAt) throw new BookingError("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม")

  const raw = tx as unknown as LockClient
  // ลำดับคงที่: พนักงานก่อน แล้วค่อยห้อง — สลับลำดับเมื่อไหร่มีโอกาส deadlock ทันที
  await raw.$queryRaw`
    SELECT pg_advisory_xact_lock(${BOOKING_THERAPIST_LOCK_NAMESPACE}::int, hashtext(${input.therapistId})::int)::text AS locked
  `
  if (input.tableId) {
    await raw.$queryRaw`
      SELECT pg_advisory_xact_lock(${BOOKING_ROOM_LOCK_NAMESPACE}::int, hashtext(${input.tableId})::int)::text AS locked
    `
  }

  const buffer = Math.max(0, input.bufferMinutes) * 60_000
  const windowStart = new Date(input.startAt.getTime() - buffer)
  const windowEnd = new Date(input.endAt.getTime() + buffer)
  const notSelf = input.bookingId ? { id: { not: input.bookingId } } : {}

  const clashTherapist = await tx.booking.findFirst({
    where: {
      ...notSelf,
      therapistId: input.therapistId,
      status: { in: [...ACTIVE_BOOKING_STATUS] },
      startAt: { lt: windowEnd },
      endAt: { gt: windowStart },
    },
    orderBy: { startAt: "asc" },
    select: { startAt: true, endAt: true },
  })
  if (clashTherapist) {
    throw new BookingError(
      `พนักงาน ${input.therapistLabel} มีคิวอยู่แล้วช่วง ${formatHhMm(minuteOfBusinessDay(clashTherapist.startAt))}–${formatHhMm(minuteOfBusinessDay(clashTherapist.endAt))} น.`,
    )
  }

  if (!input.tableId) return
  const clashRoom = await tx.booking.findFirst({
    where: {
      ...notSelf,
      tableId: input.tableId,
      status: { in: [...ACTIVE_BOOKING_STATUS] },
      startAt: { lt: windowEnd },
      endAt: { gt: windowStart },
    },
    orderBy: { startAt: "asc" },
    select: { startAt: true, endAt: true },
  })
  if (clashRoom) {
    throw new BookingError(
      `ห้อง ${input.tableCode ?? ""} ไม่ว่างช่วง ${formatHhMm(minuteOfBusinessDay(clashRoom.startAt))}–${formatHhMm(minuteOfBusinessDay(clashRoom.endAt))} น.`,
    )
  }
}

/// กะของพนักงานวันนั้นครอบช่วงเวลาที่จองไหม
///
/// **ไม่มีแถวกะ = จองได้** โดยตั้งใจ — ร้านที่ยังไม่เริ่มตั้งกะต้องจองได้ตามปกติ (กระดานจะบอกว่า "ยังไม่ตั้งกะ")
/// มีแถวแล้วถือว่าร้านนั้นใช้ระบบกะจริง จึงบังคับตามนั้น: หยุด = จองไม่ได้ · นอกเวลากะ = จองไม่ได้
export async function assertWithinShift(tx: StoreTx, input: { therapistId: string; therapistLabel: string; startAt: Date; endAt: Date }): Promise<void> {
  const dayKey = businessDayKey(input.startAt)
  const shift = await tx.therapistShift.findUnique({
    where: { therapistId_workDate: { therapistId: input.therapistId, workDate: dateOnlyFromKey(dayKey) } },
    select: { startMinute: true, endMinute: true, isOff: true },
  })
  if (!shift) return
  if (shift.isOff) throw new BookingError(`พนักงาน ${input.therapistLabel} หยุดวันที่ ${dayKey}`)

  const startMinute = minuteOfBusinessDay(input.startAt)
  // คิวที่จบพอดีเที่ยงคืนให้นับเป็น 1440 ไม่ใช่ 0 (ไม่งั้นจะดูเหมือนจบก่อนเริ่ม)
  const endMinuteRaw = minuteOfBusinessDay(input.endAt)
  const endMinute = businessDayKey(input.endAt) === dayKey ? endMinuteRaw : endMinuteRaw + 1440
  if (startMinute < shift.startMinute || endMinute > shift.endMinute) {
    throw new BookingError(
      `คิวนี้อยู่นอกกะของพนักงาน ${input.therapistLabel} (${formatHhMm(shift.startMinute)}–${formatHhMm(shift.endMinute)} น.)`,
    )
  }
}

/// เลื่อนสถานะของการจองตามการทำงานจริงหน้าห้อง (Phase 20b)
///
/// ผูกกับ session + พนักงาน เพราะบรรทัดบริการรู้แค่สองอย่างนี้ — ไม่มีการจอง (ลูกค้า walk-in) ก็ไม่เกิดอะไรขึ้น
export async function advanceSessionBooking(
  tx: StoreTx,
  input: { tableSessionId: string; therapistId: string | null; to: "IN_SERVICE" | "DONE" },
): Promise<void> {
  if (!input.therapistId) return
  const from: BookingStatus[] = input.to === "IN_SERVICE" ? ["BOOKED", "CHECKED_IN"] : ["BOOKED", "CHECKED_IN", "IN_SERVICE"]
  await tx.booking.updateMany({
    where: { tableSessionId: input.tableSessionId, therapistId: input.therapistId, status: { in: from } },
    data: { status: input.to },
  })
}
