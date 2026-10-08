import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { CheckInResult } from "@/app/actions/bookings"
import { addDays, businessDayKey, businessDayTime } from "@/lib/day"
import {
  createFullDayShifts,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  setStoreSettings,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// ปุ่มสถานะบนตารางจอง + กระดานห้องนวดตรงกับตารางจอง + ทิกเก็ตจัดห้อง (2026-10-08)
///
/// สิ่งที่ต้องพิสูจน์: เริ่มนวด/เสร็จจากตารางจองเดินทั้งคิวและรายการในบิล (conditional ทั้งคู่ กดพร้อมกันผ่านครั้งเดียว) ·
/// กระดานคิดจากสถานะคิว (ไม่ใช่ช่วงเวลา) จึงตรงกับตารางจองทุกขั้น · เลือกวันได้ และบิลค้างข้ามวันไม่ทำให้พนักงานติด "กำลังนวด"
describe.skipIf(!dbReady)("ร้านนวด — ตารางจองกดสถานะ + กระดานห้อง (2026-10-08)", () => {
  let saveBooking: (formData: FormData) => Promise<ActionResult<{ id: string }>>
  let checkInBooking: (formData: FormData) => Promise<ActionResult<CheckInResult>>
  let startBookingService: (formData: FormData) => Promise<ActionResult>
  let finishBookingService: (formData: FormData) => Promise<ActionResult>
  let cancelBooking: (formData: FormData) => Promise<ActionResult>
  let markBookingNoShow: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")

  const today = businessDayKey()
  const at = (minute: number) => businessDayTime(today, minute)

  beforeAll(async () => {
    const bookings = await import("@/app/actions/bookings")
    saveBooking = bookings.saveBooking
    checkInBooking = bookings.checkInBooking
    startBookingService = bookings.startBookingService
    finishBookingService = bookings.finishBookingService
    cancelBooking = bookings.cancelBooking
    markBookingNoShow = bookings.markBookingNoShow
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ hasKDS: true })
    await testPrisma().storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { spaEnabled: true } })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function seedSpa() {
    const db = testPrisma()
    const thai = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดไทย" } })
    const program = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดไทย 60", price: "300.00", itemType: "SERVICE", durationMinutes: 60, stationId: thai.id },
    })
    const t1 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด", skills: { connect: [{ id: thai.id }] } } })
    const t2 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "002", name: "หน่อย", skills: { connect: [{ id: thai.id }] } } })
    const room1 = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/1", kind: "ROOM", stationId: thai.id } })
    const room2 = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/2", kind: "ROOM" } })
    await createFullDayShifts([t1.id, t2.id], [today])
    return { program, t1, t2, room1, room2 }
  }

  async function book(input: { menuItemId: string; therapistId: string; tableId?: string; startTime: string; customerName?: string; date?: string }) {
    const result = await saveBooking(
      makeFormData({
        customerName: input.customerName ?? "คุณเอ",
        customerPhone: "0812345678",
        menuItemId: input.menuItemId,
        therapistId: input.therapistId,
        tableId: input.tableId ?? "",
        bookingDate: input.date ?? today,
        startTime: input.startTime,
        note: "",
      }),
    )
    expect(result.ok, result.ok ? "" : result.error).toBe(true)
    return result.ok ? (result.data?.id ?? "") : ""
  }

  async function serviceItemOf(bookingId: string) {
    const booking = await testPrisma().booking.findUniqueOrThrow({ where: { id: bookingId } })
    return testPrisma().mobileOrderItem.findFirstOrThrow({ where: { order: { tableSessionId: booking.tableSessionId ?? "" } } })
  }

  describe("ปุ่มเริ่มนวด / เสร็จแล้ว บนตารางจอง", () => {
    it("เดินทีละขั้น: เช็กอิน → เริ่มนวด → เสร็จ · คิวและรายการในบิลเปลี่ยนพร้อมกัน · กดข้ามขั้นไม่ได้", async () => {
      const db = testPrisma()
      const { program, t1, room1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" })

      // ยังไม่เช็กอิน — เริ่มนวดไม่ได้
      const early = await startBookingService(makeFormData({ id }))
      expect(early.ok).toBe(false)

      expect((await checkInBooking(makeFormData({ id, tableId: room1.id }))).ok).toBe(true)

      // เช็กอินแล้วแต่ยังไม่เริ่ม — กดเสร็จไม่ได้
      const skip = await finishBookingService(makeFormData({ id }))
      expect(skip.ok).toBe(false)
      expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe("CHECKED_IN")

      expect((await startBookingService(makeFormData({ id }))).ok).toBe(true)
      expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe("IN_SERVICE")
      expect((await serviceItemOf(id)).status).toBe("COOKING")
      // หน้าห้องไม่เตือน "รอเริ่มนวด" แล้ว เพราะรายการในบิลเดินตาม
      expect(await queries.listServicesAwaitingStart(TEST_STORE_ID)).toHaveLength(0)

      expect((await finishBookingService(makeFormData({ id }))).ok).toBe(true)
      expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe("DONE")
      expect((await serviceItemOf(id)).status).toBe("SERVED")
    })

    it("★ กดเริ่มนวดพร้อมกัน 5 เครื่อง ผ่านได้ครั้งเดียว", async () => {
      const { program, t1, room1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" })
      await checkInBooking(makeFormData({ id, tableId: room1.id }))

      const results = await Promise.all(Array.from({ length: 5 }, () => startBookingService(makeFormData({ id }))))
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect((await serviceItemOf(id)).status).toBe("COOKING")
    })

    it("รายการนวดในบิลถูกยกเลิกไปแล้ว → เริ่มนวดไม่ได้ และคิวไม่ขยับ (ถอยทั้งทรานแซคชัน)", async () => {
      const db = testPrisma()
      const { program, t1, room1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" })
      await checkInBooking(makeFormData({ id, tableId: room1.id }))
      const item = await serviceItemOf(id)
      await db.mobileOrderItem.update({ where: { id: item.id }, data: { status: "CANCELLED" } })

      const result = await startBookingService(makeFormData({ id }))
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ไม่พบรายการนวด")
      expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe("CHECKED_IN")
    })

    it("ทิกเก็ตจัดห้องออกได้หลังเช็กอินเท่านั้น และมีห้อง/พนักงาน/เวลาครบ", async () => {
      const { program, t1, room1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" })
      expect(await queries.getBookingTicket(TEST_STORE_ID, id)).toBeNull()

      await checkInBooking(makeFormData({ id, tableId: room1.id }))
      const ticket = await queries.getBookingTicket(TEST_STORE_ID, id)
      expect(ticket).toMatchObject({
        customerName: "คุณเอ",
        programName: "นวดไทย 60",
        durationMinutes: 60,
        therapistLabel: "001 นิด",
        roomCode: "3/1",
        status: "CHECKED_IN",
      })
      expect(ticket?.checkedInAt).not.toBeNull()
    })
  })

  describe("ไม่มาตามนัด / ยกเลิกคิว ตามสถานะ (2026-10-08)", () => {
    it("เช็กอินแล้ว = ลูกค้ามาแล้ว บันทึกไม่มาตามนัดไม่ได้", async () => {
      const { program, t1, room1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" })
      await checkInBooking(makeFormData({ id, tableId: room1.id }))

      const result = await markBookingNoShow(makeFormData({ id }))
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("เช็กอินแล้ว")
      expect((await testPrisma().booking.findUniqueOrThrow({ where: { id } })).status).toBe("CHECKED_IN")
    })

    it("เริ่มนวดแล้ว ยกเลิกคิวและบันทึกไม่มาไม่ได้ทั้งคู่", async () => {
      const { program, t1, room1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" })
      await checkInBooking(makeFormData({ id, tableId: room1.id }))
      await startBookingService(makeFormData({ id }))

      expect((await cancelBooking(makeFormData({ id }))).ok).toBe(false)
      expect((await markBookingNoShow(makeFormData({ id }))).ok).toBe(false)
      expect((await testPrisma().booking.findUniqueOrThrow({ where: { id } })).status).toBe("IN_SERVICE")
      expect((await serviceItemOf(id)).status).toBe("COOKING")
    })

    it("★ ยกเลิกคิวที่เช็กอินแล้ว → รายการนวดในบิลห้องถูกยกเลิกด้วย (บิลไม่คิดเงินโปรแกรมที่ไม่ได้นวด)", async () => {
      const { program, t1, room1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" })
      await checkInBooking(makeFormData({ id, tableId: room1.id }))

      expect((await cancelBooking(makeFormData({ id, reason: "ลูกค้าเปลี่ยนใจ" }))).ok).toBe(true)
      expect((await testPrisma().booking.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED")
      expect((await serviceItemOf(id)).status).toBe("CANCELLED")
    })

    it("คิวที่ยังไม่มา บันทึกไม่มาตามนัดได้ตามเดิม", async () => {
      const { program, t1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" })
      expect((await markBookingNoShow(makeFormData({ id }))).ok).toBe(true)
      expect((await testPrisma().booking.findUniqueOrThrow({ where: { id } })).status).toBe("NO_SHOW")
    })
  })

  describe("กระดานห้องตรงกับตารางจอง", () => {
    it("ทุกขั้นของคิว: รอลูกค้า → รอเริ่มนวด → กำลังนวด (+เกินเวลา) → นวดเสร็จรอปิดบิล", async () => {
      const { program, t1, room1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, tableId: room1.id, startTime: "13:00" })
      const boardAt = async (minute: number) => {
        const board = await queries.getSpaBoard(TEST_STORE_ID, { now: at(minute) })
        return { t1: board.therapists.find((t) => t.id === t1.id), room: board.rooms.find((r) => r.id === room1.id) }
      }

      // ก่อนถึงเวลา: ห้องว่าง มีคิวถัดไป
      let view = await boardAt(12 * 60)
      expect(view.room).toMatchObject({ state: "FREE", nextBookingCustomer: "คุณเอ" })
      expect(view.t1).toMatchObject({ state: "FREE", nextBookingOverdue: false })

      // ★ เลยเวลาแต่ยังไม่เช็กอิน: ห้องไม่ขึ้น "ใช้งานอยู่" (บั๊กเดิม) · คิวไม่หายจากคิวถัดไป
      view = await boardAt(13 * 60 + 15)
      expect(view.room?.state).toBe("AWAITING_GUEST")
      expect(view.t1).toMatchObject({ state: "FREE", nextBookingCustomer: "คุณเอ", nextBookingOverdue: true })

      await checkInBooking(makeFormData({ id, tableId: room1.id }))
      view = await boardAt(13 * 60 + 15)
      expect(view.t1).toMatchObject({ state: "WAITING", roomCode: "3/1", customerName: "คุณเอ" })
      expect(view.room).toMatchObject({ state: "WAITING", customerName: "คุณเอ" })

      await startBookingService(makeFormData({ id }))
      view = await boardAt(13 * 60 + 30)
      expect(view.t1).toMatchObject({ state: "BUSY", overrun: false, walkIn: false })
      expect(view.room).toMatchObject({ state: "IN_SERVICE", overrun: false })

      // ★ นวดเลยเวลาจอง: ห้อง/พนักงานยังไม่ว่าง (บั๊กเดิมขึ้นว่างเพราะดูแค่ endAt)
      view = await boardAt(14 * 60 + 30)
      expect(view.t1).toMatchObject({ state: "BUSY", overrun: true })
      expect(view.room).toMatchObject({ state: "IN_SERVICE", overrun: true })

      await finishBookingService(makeFormData({ id }))
      view = await boardAt(14 * 60 + 30)
      expect(view.t1?.state).toBe("FREE")
      expect(view.room).toMatchObject({ state: "OCCUPIED", awaitingPayment: true })

      // สถานะคิวบนกระดานกับตารางจองเป็นค่าเดียวกัน
      const day = await queries.getBookingDay(TEST_STORE_ID, today)
      const board = await queries.getSpaBoard(TEST_STORE_ID, { now: at(14 * 60 + 30) })
      expect(board.bookings.map((b) => [b.id, b.status])).toEqual(day.bookings.map((b) => [b.id, b.status]))
    })

    it("คิวที่ยังไม่เลือกห้องขึ้นในกล่องแยก ไม่หายจากกระดาน", async () => {
      const { program, t1 } = await seedSpa()
      const id = await book({ menuItemId: program.id, therapistId: t1.id, startTime: "15:00" })
      const board = await queries.getSpaBoard(TEST_STORE_ID, { now: at(12 * 60) })
      expect(board.unassigned.map((b) => b.id)).toEqual([id])
    })

    it("เลือกวันอื่น: ไม่มีสถานะสด แสดงกะ/คิวของวันนั้น · คิวของพรุ่งนี้ไม่ปนกับวันนี้", async () => {
      const { program, t1, t2, room1 } = await seedSpa()
      const tomorrow = addDays(today, 1)
      await createFullDayShifts([t1.id], [tomorrow])
      const id = await book({ menuItemId: program.id, therapistId: t1.id, tableId: room1.id, startTime: "10:00", date: tomorrow })

      const next = await queries.getSpaBoard(TEST_STORE_ID, { dayKey: tomorrow })
      expect(next.live).toBe(false)
      expect(next.dayKey).toBe(tomorrow)
      expect(next.therapists.find((t) => t.id === t1.id)).toMatchObject({ state: "ON_SHIFT" })
      expect(next.therapists.find((t) => t.id === t1.id)?.bookings.map((b) => b.id)).toEqual([id])
      expect(next.therapists.find((t) => t.id === t2.id)?.state).toBe("NO_SHIFT")
      expect(next.rooms.find((r) => r.id === room1.id)?.bookings.map((b) => b.id)).toEqual([id])

      const now = await queries.getSpaBoard(TEST_STORE_ID)
      expect(now.live).toBe(true)
      expect(now.bookings).toHaveLength(0)
    })

    it("★ บิลที่ลืมปิดตั้งแต่เมื่อวานไม่ทำให้พนักงานติด \"กำลังนวด\" วันนี้ · ห้องบอกว่าบิลค้าง", async () => {
      const db = testPrisma()
      const { program, t2, room2 } = await seedSpa()
      const yesterday = new Date(Date.now() - 26 * 60 * 60_000)
      const session = await db.tableSession.create({
        data: { storeId: TEST_STORE_ID, tableId: room2.id, openedAt: yesterday, customerLabel: "คุณเมื่อวาน" },
      })
      await db.mobileOrder.create({
        data: {
          storeId: TEST_STORE_ID,
          tableSessionId: session.id,
          orderNumber: 1,
          items: { create: [{ menuItemId: program.id, quantity: 1, unitPrice: "300.00", therapistId: t2.id, status: "COOKING" }] },
        },
      })

      const board = await queries.getSpaBoard(TEST_STORE_ID)
      expect(board.therapists.find((t) => t.id === t2.id)?.state).not.toBe("BUSY")
      const room = board.rooms.find((r) => r.id === room2.id)
      expect(room?.state).toBe("OCCUPIED")
      expect(room?.customerName).toBe("คุณเมื่อวาน")
      expect(room?.staleSince).not.toBeNull()
    })

    it("ลูกค้า walk-in ที่กำลังนวด (บิลเปิดวันนี้ ไม่มีคิวจอง) ยังนับเป็นกำลังนวด", async () => {
      const db = testPrisma()
      const { program, t2, room2 } = await seedSpa()
      const session = await db.tableSession.create({ data: { storeId: TEST_STORE_ID, tableId: room2.id, customerLabel: "walk-in" } })
      await db.mobileOrder.create({
        data: {
          storeId: TEST_STORE_ID,
          tableSessionId: session.id,
          orderNumber: 1,
          items: { create: [{ menuItemId: program.id, quantity: 1, unitPrice: "300.00", therapistId: t2.id, status: "COOKING" }] },
        },
      })

      const board = await queries.getSpaBoard(TEST_STORE_ID)
      expect(board.therapists.find((t) => t.id === t2.id)).toMatchObject({ state: "BUSY", walkIn: true, roomCode: "3/2" })
      // ★ ห้องต้องขึ้น "กำลังนวด" ตรงกับพนักงาน (เจ้าของเจอ 2026-10-08: พนักงานขึ้นกำลังนวด แต่ห้องไม่ขึ้น)
      expect(board.rooms.find((r) => r.id === room2.id)).toMatchObject({
        state: "IN_SERVICE",
        customerName: "walk-in",
        therapistLabel: "002 หน่อย",
        staleSince: null,
      })
    })

    it("★ เริ่มนวดจากหน้าห้อง (ไม่ผ่านตารางจอง) → ห้องและพนักงานขึ้นกำลังนวดตรงกัน", async () => {
      const { program, t1, room1 } = await seedSpa()
      const { startServiceItem } = await import("@/app/actions/orders")
      const id = await book({ menuItemId: program.id, therapistId: t1.id, tableId: room1.id, startTime: "13:00" })
      await checkInBooking(makeFormData({ id, tableId: room1.id }))
      expect((await startServiceItem(makeFormData({ id: (await serviceItemOf(id)).id }))).ok).toBe(true)

      const board = await queries.getSpaBoard(TEST_STORE_ID, { now: at(13 * 60 + 20) })
      expect(board.therapists.find((t) => t.id === t1.id)?.state).toBe("BUSY")
      expect(board.rooms.find((r) => r.id === room1.id)).toMatchObject({ state: "IN_SERVICE", therapistLabel: "001 นิด" })
    })
  })
})
