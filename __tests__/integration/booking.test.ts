import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { CheckInResult } from "@/app/actions/bookings"
import { businessDayKey, businessDayTime } from "@/lib/day"
import {
  disconnectTestDb,
  ensureTestUser,
  createFullDayShifts,
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

/// การจองล่วงหน้าของร้านนวด (Phase 20b)
///
/// สิ่งที่ต้องพิสูจน์: คิวไม่ชนกันแม้ยิงพร้อมกัน (advisory lock) · buffer ระหว่างคิว · ทักษะ/ประเภทห้องต้องตรง ·
/// กะคุมเวลาจองได้ · เช็กอินเปิด session + ออร์เดอร์ด้วยเส้นทางเดิมและกดซ้ำไม่ได้ · สถานะเดินตามงานจริงและปิดบิล
describe.skipIf(!dbReady)("ร้านนวด — จองล่วงหน้า (Phase 20b)", () => {
  let saveBooking: (formData: FormData) => Promise<ActionResult<{ id: string }>>
  let cancelBooking: (formData: FormData) => Promise<ActionResult>
  let markBookingNoShow: (formData: FormData) => Promise<ActionResult>
  let checkInBooking: (formData: FormData) => Promise<ActionResult<CheckInResult>>
  let saveShift: (formData: FormData) => Promise<ActionResult>
  let startServiceItem: (formData: FormData) => Promise<ActionResult>
  let markItemServed: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")
  let closeSessionWithPayment: typeof import("@/lib/close-session").closeSessionWithPayment

  const today = businessDayKey()

  beforeAll(async () => {
    const bookings = await import("@/app/actions/bookings")
    saveBooking = bookings.saveBooking
    cancelBooking = bookings.cancelBooking
    markBookingNoShow = bookings.markBookingNoShow
    checkInBooking = bookings.checkInBooking
    saveShift = (await import("@/app/actions/therapist-shifts")).saveShift
    const orders = await import("@/app/actions/orders")
    startServiceItem = orders.startServiceItem
    markItemServed = orders.markItemServed
    queries = await import("@/lib/queries")
    closeSessionWithPayment = (await import("@/lib/close-session")).closeSessionWithPayment
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

  /// ประเภทบริการ 2 · โปรแกรมนวดไทย 60 นาที · พนักงาน 001 (นวดไทย) / 002 (นวดเท้า) · ห้องนวดไทย 1 ห้อง + ห้องทั่วไป · โต๊ะอาหาร 1 ตัว
  async function seedSpa() {
    const db = testPrisma()
    const thai = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดไทย" } })
    const foot = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดเท้า" } })
    const program = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดไทย 60", price: "300.00", itemType: "SERVICE", durationMinutes: 60, stationId: thai.id },
    })
    const food = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "น้ำขิง", price: "40.00", itemType: "FOOD" } })
    const t1 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด", skills: { connect: [{ id: thai.id }] } } })
    const t2 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "002", name: "หน่อย", skills: { connect: [{ id: foot.id }] } } })
    const roomThai = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/1", kind: "ROOM", stationId: thai.id } })
    const roomAny = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/2", kind: "ROOM" } })
    const diningTable = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "A1" } })
    // ไม่มีกะ = จองไม่ได้ (2026-09-24) — ปูกะเต็มวันไว้ เทสเรื่องกะลบทิ้งเองก่อน
    await createFullDayShifts([t1.id, t2.id], [today])
    return { thai, foot, program, food, t1, t2, roomThai, roomAny, diningTable }
  }

  function bookingForm(input: {
    id?: string
    menuItemId: string
    therapistId: string
    tableId?: string
    startTime: string
    customerName?: string
    date?: string
  }) {
    return makeFormData({
      ...(input.id ? { id: input.id } : {}),
      customerName: input.customerName ?? "คุณเอ",
      customerPhone: "0812345678",
      menuItemId: input.menuItemId,
      therapistId: input.therapistId,
      tableId: input.tableId ?? "",
      bookingDate: input.date ?? today,
      startTime: input.startTime,
      note: "",
    })
  }

  describe("กันคิวชนกัน", () => {
    it("จองได้ · คิวทับซ้อนของพนักงานคนเดิมถูกปฏิเสธ · เว้น buffer 10 นาทีแล้วจองต่อได้", async () => {
      const { program, t1 } = await seedSpa()

      const first = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" }))
      expect(first.ok).toBe(true)

      // 13:30 อยู่กลางคิวเดิม (13:00–14:00)
      const overlap = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:30", customerName: "คุณบี" }))
      expect(overlap.ok).toBe(false)
      expect(overlap.ok === false && overlap.error).toContain("มีคิวช่วง 13:00–14:00 น.")

      // 14:00 ติดกันพอดี — buffer 10 นาที (ค่าเริ่มต้น) ยังกันอยู่
      const tooClose = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "14:00", customerName: "คุณบี" }))
      expect(tooClose.ok).toBe(false)
      // ต้องบอกเวลาที่เริ่มได้จริง ไม่ใช่แค่ช่วงที่ชน (2026-09-23)
      expect(tooClose.ok === false && tooClose.error).toContain("เริ่มคิวใหม่ได้ตั้งแต่ 14:10 น. (พักระหว่างคิว 10 นาที)")

      const afterBuffer = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "14:10", customerName: "คุณบี" }))
      expect(afterBuffer.ok).toBe(true)
      expect(await testPrisma().booking.count({ where: { storeId: TEST_STORE_ID } })).toBe(2)
    })

    it("กรณีเจ้าของร้านเจอ: 90 นาที 16:00–17:30 · 17:31 ไม่ผ่านเพราะพัก 10 นาที · 17:40 ผ่าน · ตั้งพัก 0 แล้ว 17:30 ผ่าน", async () => {
      const db = testPrisma()
      const { thai, t1, t2 } = await seedSpa()
      const program90 = await db.menuItem.create({
        data: { storeId: TEST_STORE_ID, name: "นวดไทย 90", price: "450.00", itemType: "SERVICE", durationMinutes: 90, stationId: thai.id },
      })
      await db.therapist.update({ where: { id: t2.id }, data: { skills: { connect: [{ id: thai.id }] } } })

      expect((await saveBooking(bookingForm({ menuItemId: program90.id, therapistId: t1.id, startTime: "16:00" }))).ok).toBe(true)

      const at1731 = await saveBooking(bookingForm({ menuItemId: program90.id, therapistId: t1.id, startTime: "17:31", customerName: "คุณบี" }))
      expect(at1731.ok).toBe(false)
      expect(at1731.ok === false && at1731.error).toContain("เริ่มคิวใหม่ได้ตั้งแต่ 17:40 น.")
      // เศษนาทีรับได้ปกติ — 17:40 ผ่าน
      expect((await saveBooking(bookingForm({ menuItemId: program90.id, therapistId: t1.id, startTime: "17:40", customerName: "คุณบี" }))).ok).toBe(true)

      // ร้านตั้งพักระหว่างคิวเป็น 0 → ต่อคิวได้ทันทีที่ 17:30 (ใช้พนักงานอีกคนที่มีคิว 16:00 เหมือนกัน)
      await db.storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { bookingBufferMinutes: 0 } })
      expect((await saveBooking(bookingForm({ menuItemId: program90.id, therapistId: t2.id, startTime: "16:00", customerName: "คุณซี" }))).ok).toBe(true)
      const at1729 = await saveBooking(bookingForm({ menuItemId: program90.id, therapistId: t2.id, startTime: "17:29", customerName: "คุณดี" }))
      expect(at1729.ok === false && at1729.error).toContain("เริ่มคิวใหม่ได้ตั้งแต่ 17:30 น.")
      expect(at1729.ok === false && at1729.error).not.toContain("พักระหว่างคิว")
      expect((await saveBooking(bookingForm({ menuItemId: program90.id, therapistId: t2.id, startTime: "17:30", customerName: "คุณดี" }))).ok).toBe(true)
    })

    it("ห้องเดียวกันชนกันถูกปฏิเสธแม้เป็นคนละพนักงาน", async () => {
      const db = testPrisma()
      const { program, t1, t2, thai, roomThai } = await seedSpa()
      // ให้ 002 มีทักษะนวดไทยด้วย เพื่อให้เหลือตัวแปรเดียวคือ "ห้องชนกัน"
      await db.therapist.update({ where: { id: t2.id }, data: { skills: { connect: [{ id: thai.id }] } } })

      const first = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, tableId: roomThai.id, startTime: "13:00" }))
      expect(first.ok).toBe(true)

      const clash = await saveBooking(
        bookingForm({ menuItemId: program.id, therapistId: t2.id, tableId: roomThai.id, startTime: "13:30", customerName: "คุณบี" }),
      )
      expect(clash.ok).toBe(false)
      expect(clash.ok === false && clash.error).toContain("ไม่ว่าง")

      // คนละห้องจองเวลาเดียวกันได้
      const { roomAny } = await seedRooms()
      const ok = await saveBooking(
        bookingForm({ menuItemId: program.id, therapistId: t2.id, tableId: roomAny, startTime: "13:30", customerName: "คุณบี" }),
      )
      expect(ok.ok).toBe(true)
    })

    /// ★ กติกาข้อ 4 — "อ่านว่าว่างแล้วค่อยเขียน" ต้องผ่านได้ใบเดียวเมื่อยิงพร้อมกัน
    it("ยิงจองช่วงเวลาเดียวกัน 10 คำขอพร้อมกัน ต้องผ่านแค่ 1", async () => {
      const { program, t1 } = await seedSpa()

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "15:00", customerName: `ลูกค้า ${index}` })),
        ),
      )

      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect(await testPrisma().booking.count({ where: { storeId: TEST_STORE_ID } })).toBe(1)
    })

    it("ยกเลิก/ไม่มาตามนัด คืนช่วงเวลาให้จองใหม่ได้", async () => {
      const { program, t1 } = await seedSpa()
      const first = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" }))
      const id = first.ok ? first.data?.id ?? "" : ""

      expect((await cancelBooking(makeFormData({ id, reason: "ลูกค้าเลื่อน" }))).ok).toBe(true)
      const again = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", customerName: "คุณบี" }))
      expect(again.ok).toBe(true)

      const secondId = again.ok ? again.data?.id ?? "" : ""
      expect((await markBookingNoShow(makeFormData({ id: secondId }))).ok).toBe(true)
      expect((await testPrisma().booking.findUniqueOrThrow({ where: { id: secondId } })).status).toBe("NO_SHOW")
      const third = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", customerName: "คุณซี" }))
      expect(third.ok).toBe(true)
    })
  })

  describe("ความเข้ากันของโปรแกรม / พนักงาน / ห้อง", () => {
    it("ทักษะไม่ตรง · ห้องผิดประเภท · โต๊ะอาหาร · เมนูอาหาร ถูกปฏิเสธทั้งหมด", async () => {
      const { program, food, t1, t2, roomAny, diningTable } = await seedSpa()

      const wrongSkill = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t2.id, startTime: "13:00" }))
      expect(wrongSkill.ok).toBe(false)
      expect(wrongSkill.ok === false && wrongSkill.error).toContain("ทักษะ")

      const foodBooking = await saveBooking(bookingForm({ menuItemId: food.id, therapistId: t1.id, startTime: "13:00" }))
      expect(foodBooking.ok).toBe(false)

      const onDiningTable = await saveBooking(
        bookingForm({ menuItemId: program.id, therapistId: t1.id, tableId: diningTable.id, startTime: "13:00" }),
      )
      expect(onDiningTable.ok).toBe(false)
      expect(onDiningTable.ok === false && onDiningTable.error).toContain("โต๊ะอาหาร")

      // ห้องที่ไม่ระบุประเภทใช้ได้กับทุกโปรแกรม
      const ok = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, tableId: roomAny.id, startTime: "13:00" }))
      expect(ok.ok).toBe(true)
      expect(await testPrisma().booking.count({ where: { storeId: TEST_STORE_ID } })).toBe(1)
    })

    it("ห้องคนละประเภทบริการกับโปรแกรมถูกปฏิเสธ", async () => {
      const db = testPrisma()
      const { program, t1, foot } = await seedSpa()
      const footRoom = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "4/1", kind: "ROOM", stationId: foot.id } })

      const result = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, tableId: footRoom.id, startTime: "13:00" }))
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ห้อง 4/1")
    })
  })

  describe("กะทำงาน", () => {
    it("ไม่มีแถวกะ = จองไม่ได้ · วันหยุด = จองไม่ได้ · นอกเวลากะ = จองไม่ได้", async () => {
      const { program, t1 } = await seedSpa()
      await testPrisma().therapistShift.deleteMany({ where: { storeId: TEST_STORE_ID } })

      // ยังไม่ตั้งกะ — จองไม่ได้ (เจ้าของสั่ง 2026-09-24 · เดิม 20b ปล่อยให้จองได้)
      const noShift = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" }))
      expect(noShift.ok).toBe(false)
      expect(noShift.ok === false && noShift.error).toContain("ยังไม่ได้ลงกะ")
      expect(await testPrisma().booking.count({ where: { storeId: TEST_STORE_ID } })).toBe(0)

      // ตั้งกะ 09:00–14:00 → 13:30 ล้นออกนอกกะ
      expect(
        (await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "09:00", endTime: "14:00", isOff: "false" }))).ok,
      ).toBe(true)
      const outside = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:30" }))
      expect(outside.ok).toBe(false)
      expect(outside.ok === false && outside.error).toContain("นอกกะ")

      const inside = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "09:30" }))
      expect(inside.ok).toBe(true)

      // เปลี่ยนเป็นวันหยุด → จองใหม่ไม่ได้
      expect(
        (await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "09:00", endTime: "14:00", isOff: "true" }))).ok,
      ).toBe(true)
      const offDay = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "11:00", customerName: "คุณบี" }))
      expect(offDay.ok).toBe(false)
      expect(offDay.ok === false && offDay.error).toContain("หยุด")
    })

    it("กะถูกลบหลังจองไปแล้ว → เช็กอินไม่ได้ และไม่มีออร์เดอร์/บิลเกิดขึ้น", async () => {
      const db = testPrisma()
      const { program, t1, roomThai } = await seedSpa()
      const created = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" }))
      const bookingId = created.ok ? created.data?.id ?? "" : ""
      await db.therapistShift.deleteMany({ where: { therapistId: t1.id } })

      const result = await checkInBooking(makeFormData({ id: bookingId, tableId: roomThai.id }))
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ยังไม่ได้ลงกะ")
      // ทรานแซคชันถอยทั้งก้อน — การจองยังเป็น BOOKED ห้องยังว่าง
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("BOOKED")
      expect(await db.mobileOrder.count({ where: { storeId: TEST_STORE_ID } })).toBe(0)
      expect((await db.table.findUniqueOrThrow({ where: { id: roomThai.id } })).status).toBe("EMPTY")
    })
  })

  describe("เช็กอิน → บิลเส้นทางเดิม", () => {
    it("เช็กอินเปิด session + ออร์เดอร์บริการพร้อมพนักงาน · กดซ้ำไม่ได้", async () => {
      const db = testPrisma()
      const { program, t1, roomThai } = await seedSpa()
      const created = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" }))
      const bookingId = created.ok ? created.data?.id ?? "" : ""

      const checkedIn = await checkInBooking(makeFormData({ id: bookingId, tableId: roomThai.id }))
      expect(checkedIn.ok).toBe(true)
      const sessionId = checkedIn.ok ? checkedIn.data?.sessionId ?? "" : ""

      const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } })
      expect(booking.status).toBe("CHECKED_IN")
      expect(booking.tableSessionId).toBe(sessionId)
      expect(booking.tableId).toBe(roomThai.id)

      // ออร์เดอร์ออกเป็น MobileOrder ปกติ พร้อม therapistId บนบรรทัด (กติกาข้อ 8)
      const items = await db.mobileOrderItem.findMany({ where: { order: { tableSessionId: sessionId } } })
      expect(items).toHaveLength(1)
      expect(items[0].therapistId).toBe(t1.id)
      expect(items[0].unitPrice.toString()).toBe("300")
      expect((await db.table.findUniqueOrThrow({ where: { id: roomThai.id } })).status).toBe("ORDERED")

      const twice = await checkInBooking(makeFormData({ id: bookingId, tableId: roomThai.id }))
      expect(twice.ok).toBe(false)
      expect(await db.mobileOrder.count({ where: { storeId: TEST_STORE_ID } })).toBe(1)
    })

    it("เช็กอินพร้อมกัน 5 คำขอ ต้องได้ออร์เดอร์ใบเดียว", async () => {
      const { program, t1, roomThai } = await seedSpa()
      const created = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" }))
      const bookingId = created.ok ? created.data?.id ?? "" : ""

      const results = await Promise.all(
        Array.from({ length: 5 }, () => checkInBooking(makeFormData({ id: bookingId, tableId: roomThai.id }))),
      )
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect(await testPrisma().mobileOrder.count({ where: { storeId: TEST_STORE_ID } })).toBe(1)
    })

    it("เริ่มนวด → IN_SERVICE · นวดเสร็จ → DONE", async () => {
      const db = testPrisma()
      const { program, t1, roomThai } = await seedSpa()
      const created = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" }))
      const bookingId = created.ok ? created.data?.id ?? "" : ""
      const checkedIn = await checkInBooking(makeFormData({ id: bookingId, tableId: roomThai.id }))
      const sessionId = checkedIn.ok ? checkedIn.data?.sessionId ?? "" : ""
      const item = await db.mobileOrderItem.findFirstOrThrow({ where: { order: { tableSessionId: sessionId } } })

      // 20e: เช็กอินแล้ว → ห้องขึ้นเป็น "รอเริ่มนวด" บนผังโต๊ะ + นับเข้า badge
      const waiting = await queries.listServicesAwaitingStart(TEST_STORE_ID)
      expect(waiting).toHaveLength(1)
      expect(waiting[0]).toMatchObject({ itemId: item.id, tableCode: "3/1", therapistId: t1.id, customerLabel: "คุณเอ" })
      const badgeBefore = await queries.getPendingNotificationCount(TEST_STORE_ID)

      expect((await startServiceItem(makeFormData({ id: item.id }))).ok).toBe(true)
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("IN_SERVICE")
      // กดเริ่มนวดแล้วหายเอง ไม่ต้องรับทราบ
      expect(await queries.listServicesAwaitingStart(TEST_STORE_ID)).toHaveLength(0)
      expect(await queries.getPendingNotificationCount(TEST_STORE_ID)).toBe(badgeBefore - 1)

      expect((await markItemServed(makeFormData({ id: item.id }))).ok).toBe(true)
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("DONE")
    })

    it("ปิดบิลแล้วคิวที่ยังค้างกลายเป็น DONE (กระดานไม่ค้างว่ายังนวดอยู่)", async () => {
      const db = testPrisma()
      const { program, t1, roomThai } = await seedSpa()
      const created = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00" }))
      const bookingId = created.ok ? created.data?.id ?? "" : ""
      const checkedIn = await checkInBooking(makeFormData({ id: bookingId, tableId: roomThai.id }))
      const sessionId = checkedIn.ok ? checkedIn.data?.sessionId ?? "" : ""

      const closed = await closeSessionWithPayment({
        storeId: TEST_STORE_ID,
        sessionId,
        paymentMethod: "CASH",
        cashierId: "owner",
      })
      expect(closed.ok).toBe(true)
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("DONE")
    })
  })

  describe("ชั้นอ่าน", () => {
    it("ตารางวัน · กระดาน · เตือนคิวใกล้ถึงเวลา อ่านค่าตรงกับของจริง", async () => {
      const { program, t1, t2, roomThai } = await seedSpa()
      await testPrisma().therapistShift.deleteMany({ where: { therapistId: t2.id } })
      await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "09:00", endTime: "20:00", isOff: "false" }))
      const created = await saveBooking(bookingForm({ menuItemId: program.id, therapistId: t1.id, tableId: roomThai.id, startTime: "13:00" }))
      expect(created.ok).toBe(true)

      const day = await queries.getBookingDay(TEST_STORE_ID, today)
      expect(day.bookings).toHaveLength(1)
      expect(day.bookings[0].startMinute).toBe(13 * 60)
      expect(day.bookings[0].endMinute).toBe(14 * 60)
      expect(day.bookings[0].tableCode).toBe("3/1")
      expect(day.programs.map((p) => p.id)).toEqual([program.id])
      expect(day.rooms.map((r) => r.code).sort()).toEqual(["3/1", "3/2"])
      expect(day.bufferMinutes).toBe(10)
      expect(day.shifts).toHaveLength(1)

      // "ตอนนี้" อยู่กลางคิว → พนักงานยังไม่ถือว่า BUSY เพราะยังไม่ได้เริ่มนวดจริง แต่ห้องถูกจับจองไว้แล้ว
      const board = await queries.getSpaBoard(TEST_STORE_ID, businessDayTime(today, 13 * 60 + 15))
      const row = board.therapists.find((t) => t.id === t1.id)
      expect(row?.state).toBe("FREE")
      expect(board.rooms.find((r) => r.code === "3/1")?.currentCustomer).toBe("คุณเอ")

      // เตือนล่วงหน้า 15 นาที — 12:50 เห็น, 12:30 ยังไม่เห็น
      expect(await queries.countUpcomingBookings(TEST_STORE_ID, businessDayTime(today, 12 * 60 + 50))).toBe(1)
      expect(await queries.countUpcomingBookings(TEST_STORE_ID, businessDayTime(today, 12 * 60 + 30))).toBe(0)
    })
  })

  /// ห้องเพิ่มระหว่างเทส (ใช้ซ้ำโค้ด seed ไม่ได้เพราะรหัสซ้ำ)
  async function seedRooms() {
    const room = await testPrisma().table.findFirstOrThrow({ where: { storeId: TEST_STORE_ID, code: "3/2" } })
    return { roomAny: room.id }
  }
})
