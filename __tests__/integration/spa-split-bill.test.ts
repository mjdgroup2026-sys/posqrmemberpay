import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { CheckInResult } from "@/app/actions/bookings"
import type { StaffOrderResult } from "@/app/actions/staff-order"
import { businessDayKey } from "@/lib/day"
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

/// ร้านสปา: 1 ลูกค้า = 1 บิล (2026-09-23 เจ้าของสั่ง ข้อ 7)
///
/// ปัญหาเดิม: ลูกค้าคนละคนใช้ห้องเดียวกันคนละเวลา คนแรกยังไม่จ่าย → เช็กอินคนถัดไปเข้า session เดิม → ปิดบิลได้บิลรวม
/// สิ่งที่ต้องพิสูจน์: ลูกค้าคนละคน = คนละบิล · ลูกค้าคนเดิม = บิลเดิม · ปิดบิลหนึ่งไม่ปิดอีกบิล ·
/// ห้องกลับเป็นว่างเมื่อบิลสุดท้ายปิดเท่านั้น (รวมกรณีปิดพร้อมกัน) · จอขายต้องเลือกบิลเมื่อห้องมีบิลอยู่ · โต๊ะอาหารเหมือนเดิม
describe.skipIf(!dbReady)("ร้านสปา — แยกบิลต่อลูกค้า", () => {
  let saveBooking: (formData: FormData) => Promise<ActionResult<{ id: string }>>
  let checkInBooking: (formData: FormData) => Promise<ActionResult<CheckInResult>>
  let createStaffTableOrder: (formData: FormData) => Promise<ActionResult<StaffOrderResult>>
  let cancelTableSession: (formData: FormData) => Promise<ActionResult>
  let mergeTables: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")
  let closeSessionWithPayment: typeof import("@/lib/close-session").closeSessionWithPayment

  const today = businessDayKey()

  beforeAll(async () => {
    const bookings = await import("@/app/actions/bookings")
    saveBooking = bookings.saveBooking
    checkInBooking = bookings.checkInBooking
    createStaffTableOrder = (await import("@/app/actions/staff-order")).createStaffTableOrder
    const tables = await import("@/app/actions/tables")
    cancelTableSession = tables.cancelTableSession
    mergeTables = tables.mergeTables
    queries = await import("@/lib/queries")
    closeSessionWithPayment = (await import("@/lib/close-session")).closeSessionWithPayment
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ hasKDS: false })
    await testPrisma().storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { spaEnabled: true, bookingBufferMinutes: 0 } })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// โปรแกรมนวด 60 นาที · พนักงาน 2 คน · ห้องนวด 2 ห้อง · โต๊ะอาหาร 1 ตัว · น้ำขิง (อาหาร)
  async function seed() {
    const db = testPrisma()
    const thai = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดไทย" } })
    const program = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดไทย 60", price: "300.00", itemType: "SERVICE", durationMinutes: 60, stationId: thai.id },
    })
    const drink = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "น้ำขิง", price: "40.00", itemType: "FOOD" } })
    const t1 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด", skills: { connect: [{ id: thai.id }] } } })
    const t2 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "002", name: "หน่อย", skills: { connect: [{ id: thai.id }] } } })
    const room = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/1", kind: "ROOM" } })
    const room2 = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/2", kind: "ROOM" } })
    const diningTable = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "A1" } })
    await createFullDayShifts([t1.id, t2.id], [today])
    return { program, drink, t1, t2, room, room2, diningTable }
  }

  async function book(input: { menuItemId: string; therapistId: string; startTime: string; name: string; phone?: string }) {
    const created = await saveBooking(
      makeFormData({
        customerName: input.name,
        customerPhone: input.phone ?? "",
        menuItemId: input.menuItemId,
        therapistId: input.therapistId,
        tableId: "",
        bookingDate: today,
        startTime: input.startTime,
        note: "",
      }),
    )
    expect(created.ok).toBe(true)
    return created.ok ? created.data?.id ?? "" : ""
  }

  async function checkIn(bookingId: string, tableId: string) {
    const result = await checkInBooking(makeFormData({ id: bookingId, tableId }))
    expect(result.ok).toBe(true)
    return result.ok ? result.data?.sessionId ?? "" : ""
  }

  const close = (sessionId: string) =>
    closeSessionWithPayment({ storeId: TEST_STORE_ID, sessionId, paymentMethod: "CASH", cashierId: "owner" })

  const roomStatus = async (tableId: string) => (await testPrisma().table.findUniqueOrThrow({ where: { id: tableId } })).status

  describe("เช็กอินคิวจอง", () => {
    it("ลูกค้าคนละคนในห้องเดียวกันคนละเวลา = คนละบิล · ปิดบิลแรกไม่ปิดบิลที่สอง · ห้องว่างเมื่อบิลสุดท้ายปิด", async () => {
      const db = testPrisma()
      const { program, t1, t2, room } = await seed()
      const sessionA = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "16:00", name: "คุณเอ" }), room.id)
      const sessionB = await checkIn(await book({ menuItemId: program.id, therapistId: t2.id, startTime: "17:00", name: "คุณบี" }), room.id)

      expect(sessionB).not.toBe(sessionA)
      const labels = await db.tableSession.findMany({ where: { tableId: room.id }, orderBy: { openedAt: "asc" }, select: { customerLabel: true } })
      expect(labels.map((l) => l.customerLabel)).toEqual(["คุณเอ", "คุณบี"])

      // บิลของคุณเอมีแค่ของคุณเอ (300) — ไม่รวมของคุณบี
      const billA = await queries.getBillingView(TEST_STORE_ID, room.id, sessionA)
      expect(billA?.total).toBe(300)
      expect(billA?.customerLabel).toBe("คุณเอ")
      expect(billA?.bills).toHaveLength(2)

      const closedA = await close(sessionA)
      expect(closedA.ok).toBe(true)
      const sale = await db.sale.findFirstOrThrow({ where: { tableSessionId: sessionA } })
      expect(sale.total.toString()).toBe("300")
      // ห้องยังมีบิลของคุณบีเปิดอยู่ → ยังไม่ว่าง
      expect(await roomStatus(room.id)).not.toBe("EMPTY")
      expect((await db.tableSession.findUniqueOrThrow({ where: { id: sessionB } })).status).toBe("OPEN")

      expect((await close(sessionB)).ok).toBe(true)
      expect(await roomStatus(room.id)).toBe("EMPTY")
    })

    it("ลูกค้าคนเดิม (ชื่อ+เบอร์ตรง) จองสองคิวในห้องเดียวกัน = บิลเดียว · ชื่อเดียวกันแต่เบอร์ต่าง = คนละบิล", async () => {
      const { program, t1, t2, room } = await seed()
      const first = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", name: "คุณเอ", phone: "081-111-1111" }), room.id)
      const again = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "14:00", name: " คุณเอ ", phone: "0811111111" }), room.id)
      expect(again).toBe(first)

      const otherPerson = await checkIn(await book({ menuItemId: program.id, therapistId: t2.id, startTime: "15:00", name: "คุณเอ", phone: "0822222222" }), room.id)
      expect(otherPerson).not.toBe(first)
    })

    it("20e: ห้องหลายบิล — ลูกค้าจ่ายเองผ่าน QR ห้องไม่ได้ (ไม่เดาบิล) · เหลือบิลเดียวแล้วจ่ายเองได้ตามเดิม", async () => {
      const db = testPrisma()
      const { program, t1, t2, room } = await seed()
      const qr = await db.qRCode.create({ data: { storeId: TEST_STORE_ID, tableId: room.id, token: "qr-shared-room", type: "STATIC" } })
      const { startCustomerPayment } = await import("@/app/actions/payments")

      const sessionA = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", name: "คุณเอ" }), room.id)
      await checkIn(await book({ menuItemId: program.id, therapistId: t2.id, startTime: "14:00", name: "คุณบี" }), room.id)

      const status = await queries.getCustomerPaymentStatus(qr.token)
      expect(status.state === "UNPAID" && status.sharedRoom).toBe(true)
      const blocked = await startCustomerPayment(makeFormData({ qrToken: qr.token, method: "PROMPTPAY" }))
      expect(blocked.ok).toBe(false)
      expect(blocked.ok === false && blocked.error).toContain("กรุณาแจ้งพนักงาน")
      expect(await db.notification.count({ where: { storeId: TEST_STORE_ID } })).toBe(0)

      // พนักงานปิดบิลคุณเอ → เหลือบิลคุณบีใบเดียว ลูกค้าจ่ายเองได้เหมือนโต๊ะปกติ
      expect((await close(sessionA)).ok).toBe(true)
      const after = await queries.getCustomerPaymentStatus(qr.token)
      expect(after.state === "UNPAID" && after.sharedRoom).toBe(false)
    })

    it("หน้ารายละเอียด/ปิดบิลรับ session ของห้องอื่นไม่ได้", async () => {
      const { program, t1, t2, room, room2 } = await seed()
      await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", name: "คุณเอ" }), room.id)
      const other = await checkIn(await book({ menuItemId: program.id, therapistId: t2.id, startTime: "13:00", name: "คุณบี" }), room2.id)

      expect(await queries.getTableDetail(TEST_STORE_ID, room.id, other)).toBeNull()
      expect(await queries.getBillingView(TEST_STORE_ID, room.id, other)).toBeNull()
      expect((await queries.getTableDetail(TEST_STORE_ID, room2.id, other))?.customerLabel).toBe("คุณบี")
    })
  })

  describe("จอขายพนักงาน", () => {
    const cart = (menuItemId: string, therapistId?: string) =>
      JSON.stringify([{ menuItemId, quantity: 1, optionIds: [], therapistId }])

    it("ห้องมีบิลอยู่: ไม่เลือกบิล = ปฏิเสธ · ลูกค้าใหม่ไม่ใส่ชื่อ = ปฏิเสธ · เลือกบิลเดิม/เปิดบิลใหม่ได้ถูกใบ", async () => {
      const db = testPrisma()
      const { program, drink, t1, room } = await seed()
      const sessionA = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", name: "คุณเอ" }), room.id)

      const noChoice = await createStaffTableOrder(makeFormData({ tableId: room.id, items: cart(drink.id) }))
      expect(noChoice.ok).toBe(false)
      expect(noChoice.ok === false && noChoice.error).toContain("เลือกว่าจะเพิ่มในบิลเดิม")

      const noName = await createStaffTableOrder(makeFormData({ tableId: room.id, newCustomer: "true", items: cart(drink.id) }))
      expect(noName.ok).toBe(false)

      const intoA = await createStaffTableOrder(makeFormData({ tableId: room.id, sessionId: sessionA, items: cart(drink.id) }))
      expect(intoA.ok && intoA.data?.sessionId).toBe(sessionA)

      const newBill = await createStaffTableOrder(makeFormData({ tableId: room.id, newCustomer: "true", billLabel: "คุณซี", items: cart(drink.id) }))
      expect(newBill.ok).toBe(true)
      const sessionC = newBill.ok ? newBill.data?.sessionId ?? "" : ""
      expect(sessionC).not.toBe(sessionA)
      expect((await db.tableSession.findUniqueOrThrow({ where: { id: sessionC } })).customerLabel).toBe("คุณซี")

      // บิลของคุณเอ = นวด 300 + น้ำขิง 40 · บิลของคุณซี = น้ำขิง 40
      expect((await queries.getBillingView(TEST_STORE_ID, room.id, sessionA))?.total).toBe(340)
      expect((await queries.getBillingView(TEST_STORE_ID, room.id, sessionC))?.total).toBe(40)

      const overview = await queries.listTableOverview(TEST_STORE_ID)
      const card = overview.find((t) => t.id === room.id)
      expect(card?.bills.map((b) => b.label)).toEqual(["คุณเอ", "คุณซี"])
      expect(card?.total).toBe(380)
    })

    it("session ของห้องอื่นใช้ส่งออร์เดอร์ไม่ได้ · โต๊ะอาหารแยกบิลไม่ได้และยังเป็นบิลเดียวเหมือนเดิม", async () => {
      const { program, drink, t1, room, room2, diningTable } = await seed()
      const sessionA = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", name: "คุณเอ" }), room.id)

      const wrongRoom = await createStaffTableOrder(makeFormData({ tableId: room2.id, sessionId: sessionA, items: cart(drink.id) }))
      expect(wrongRoom.ok).toBe(false)

      const splitTable = await createStaffTableOrder(makeFormData({ tableId: diningTable.id, newCustomer: "true", billLabel: "x", items: cart(drink.id) }))
      expect(splitTable.ok).toBe(false)

      const first = await createStaffTableOrder(makeFormData({ tableId: diningTable.id, items: cart(drink.id) }))
      const second = await createStaffTableOrder(makeFormData({ tableId: diningTable.id, items: cart(drink.id) }))
      expect(first.ok && second.ok).toBe(true)
      expect(first.ok && second.ok && first.data?.sessionId === second.data?.sessionId).toBe(true)
    })

    it("ห้องว่าง: ส่งแบบลูกค้าใหม่พร้อมชื่อ = เปิดบิลพร้อมป้ายชื่อ", async () => {
      const { drink, room } = await seed()
      const created = await createStaffTableOrder(makeFormData({ tableId: room.id, newCustomer: "true", billLabel: "คุณดี", items: cart(drink.id) }))
      expect(created.ok).toBe(true)
      const sessionId = created.ok ? created.data?.sessionId ?? "" : ""
      expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: sessionId } })).customerLabel).toBe("คุณดี")
      expect(await roomStatus(room.id)).toBe("ORDERED")
    })
  })

  describe("ยกเลิก / รวมโต๊ะ / พร้อมกัน", () => {
    it("ยกเลิกบิลหนึ่งในห้อง ห้องยังไม่ว่าง · รวมโต๊ะไม่ได้เมื่อห้องมีหลายบิล", async () => {
      const { program, t1, t2, room, diningTable } = await seed()
      const sessionA = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", name: "คุณเอ" }), room.id)
      await checkIn(await book({ menuItemId: program.id, therapistId: t2.id, startTime: "14:00", name: "คุณบี" }), room.id)

      const merged = await mergeTables(makeFormData({ primaryTableId: room.id, secondaryTableId: diningTable.id }))
      expect(merged.ok).toBe(false)
      expect(merged.ok === false && merged.error).toContain("บิลของลูกค้า 2 คน")

      expect((await cancelTableSession(makeFormData({ sessionId: sessionA, reason: "ลูกค้ายกเลิก" }))).ok).toBe(true)
      expect(await roomStatus(room.id)).not.toBe("EMPTY")
    })

    it("ปิดสองบิลของห้องเดียวกันพร้อมกัน ห้องต้องกลับเป็นว่าง (ไม่ค้างทั้งที่ไม่มีบิล)", async () => {
      const { program, t1, t2, room } = await seed()
      const sessionA = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", name: "คุณเอ" }), room.id)
      const sessionB = await checkIn(await book({ menuItemId: program.id, therapistId: t2.id, startTime: "14:00", name: "คุณบี" }), room.id)

      const results = await Promise.all([close(sessionA), close(sessionB)])
      expect(results.every((r) => r.ok)).toBe(true)
      expect(await roomStatus(room.id)).toBe("EMPTY")
    })

    it("ปิดบิลสุดท้ายพร้อมกับเปิดบิลลูกค้าใหม่ — ห้องต้องไม่ว่างเมื่อยังมีบิลเปิดอยู่", async () => {
      const db = testPrisma()
      const { program, drink, t1, room } = await seed()
      const sessionA = await checkIn(await book({ menuItemId: program.id, therapistId: t1.id, startTime: "13:00", name: "คุณเอ" }), room.id)

      const [closed, opened] = await Promise.all([
        close(sessionA),
        createStaffTableOrder(
          makeFormData({ tableId: room.id, newCustomer: "true", billLabel: "คุณบี", items: JSON.stringify([{ menuItemId: drink.id, quantity: 1, optionIds: [] }]) }),
        ),
      ])
      expect(closed.ok).toBe(true)
      expect(opened.ok).toBe(true)

      const live = await db.tableSession.count({ where: { tableId: room.id, status: { in: ["OPEN", "AWAITING_BILL"] } } })
      expect(live).toBe(1)
      expect(await roomStatus(room.id)).not.toBe("EMPTY")
    })
  })
})
