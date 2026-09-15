import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { TableCard, NotificationCard } from "@/lib/queries"
import {
  createTestMenuItem,
  createTestTable,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("ผังโต๊ะและการแจ้งเตือน (Phase 7)", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let mergeTables: (formData: FormData) => Promise<ActionResult>
  let acknowledgeNotification: (formData: FormData) => Promise<ActionResult>
  let acknowledgeAllNotifications: () => Promise<ActionResult>
  let listTableOverview: (storeId: string) => Promise<TableCard[]>
  let listNotifications: (storeId: string, limit?: number) => Promise<NotificationCard[]>

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const notifications = await import("@/app/actions/notifications")
    const queries = await import("@/lib/queries")
    openTableSession = tables.openTableSession
    mergeTables = tables.mergeTables
    acknowledgeNotification = notifications.acknowledgeNotification
    acknowledgeAllNotifications = notifications.acknowledgeAllNotifications
    listTableOverview = queries.listTableOverview
    listNotifications = queries.listNotifications
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function openTable(code: string) {
    const table = await createTestTable(code)
    const opened = await openTableSession(makeFormData({ tableId: table.id }))
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""
    return { table, sessionId }
  }

  async function addItems(sessionId: string, lines: { quantity: number; unitPrice: string }[]) {
    const menuItem = await createTestMenuItem({ name: `เมนู-${Math.random().toString(36).slice(2, 8)}` })
    const order = await testPrisma().mobileOrder.create({
      data: { storeId: TEST_STORE_ID, tableSessionId: sessionId, orderNumber: 1 },
    })
    for (const line of lines) {
      await testPrisma().mobileOrderItem.create({
        data: {
          mobileOrderId: order.id,
          menuItemId: menuItem.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        },
      })
    }
    return order
  }

  describe("ผังโต๊ะ", () => {
    it("การ์ดโต๊ะต้องมีเวลาเปิดโต๊ะและยอดสดของ session", async () => {
      // arrange
      const { table, sessionId } = await openTable("31")
      await addItems(sessionId, [
        { quantity: 2, unitPrice: "75.00" },
        { quantity: 1, unitPrice: "120.00" },
      ])

      // act
      const cards = await listTableOverview(TEST_STORE_ID)

      // assert
      const card = cards.find((c) => c.id === table.id)
      expect(card?.sessionId).toBe(sessionId)
      expect(card?.openedAt).toBeInstanceOf(Date)
      expect(card?.total).toBe(270)
      expect(card?.itemCount).toBe(2)
    })

    it("รายการที่ถูกยกเลิกต้องไม่ถูกนับในยอดของโต๊ะ", async () => {
      // arrange
      const { table, sessionId } = await openTable("32")
      const order = await addItems(sessionId, [{ quantity: 2, unitPrice: "50.00" }])
      await testPrisma().mobileOrderItem.updateMany({
        where: { mobileOrderId: order.id },
        data: { status: "CANCELLED" },
      })

      // act
      const cards = await listTableOverview(TEST_STORE_ID)

      // assert
      const card = cards.find((c) => c.id === table.id)
      expect(card?.total).toBe(0)
      expect(card?.itemCount).toBe(0)
    })

    it("โต๊ะที่ถูกรวมต้องรู้ว่าบิลอยู่ที่โต๊ะไหน และโต๊ะหลักต้องรู้ว่ามีโต๊ะไหนรวมอยู่", async () => {
      // arrange
      const { table: primary } = await openTable("33")
      const secondary = await createTestTable("34")
      await mergeTables(makeFormData({ primaryTableId: primary.id, secondaryTableId: secondary.id }))

      // act
      const cards = await listTableOverview(TEST_STORE_ID)

      // assert
      const primaryCard = cards.find((c) => c.id === primary.id)
      const secondaryCard = cards.find((c) => c.id === secondary.id)
      expect(primaryCard?.mergedTableCodes).toEqual(["34"])
      expect(secondaryCard?.primaryTableCode).toBe("33")
      expect(secondaryCard?.status).toBe("OCCUPIED_MERGED")
    })
  })

  describe("การแจ้งเตือน", () => {
    it("รับทราบแล้วต้องบันทึกผู้รับทราบและเวลา", async () => {
      // arrange
      const { sessionId } = await openTable("35")
      const notification = await testPrisma().notification.create({
        data: { storeId: TEST_STORE_ID, tableSessionId: sessionId, type: "CALL_STAFF", reason: "ขอน้ำเปล่าเพิ่ม" },
      })

      // act
      const result = await acknowledgeNotification(makeFormData({ id: notification.id }))

      // assert
      expect(result.ok).toBe(true)
      const after = await testPrisma().notification.findUniqueOrThrow({ where: { id: notification.id } })
      expect(after.status).toBe("ACKNOWLEDGED")
      expect(after.acknowledgedById).toBe("test-user")
      expect(after.acknowledgedAt).not.toBeNull()
    })

    it("กดรับทราบพร้อมกันหลายครั้งต้องสำเร็จแค่ครั้งเดียว", async () => {
      // arrange
      const { sessionId } = await openTable("36")
      const notification = await testPrisma().notification.create({
        data: { storeId: TEST_STORE_ID, tableSessionId: sessionId, type: "CHECK_BILL" },
      })

      // act
      const results = await Promise.all(
        Array.from({ length: 4 }, () => acknowledgeNotification(makeFormData({ id: notification.id }))),
      )

      // assert
      expect(results.filter((r) => r.ok)).toHaveLength(1)
    })

    it("รับทราบทั้งหมดต้องเคลียร์ทุกรายการที่ยังค้าง", async () => {
      // arrange
      const first = await openTable("37")
      const second = await openTable("38")
      await testPrisma().notification.createMany({
        data: [
          { storeId: TEST_STORE_ID, tableSessionId: first.sessionId, type: "CALL_STAFF" },
          { storeId: TEST_STORE_ID, tableSessionId: second.sessionId, type: "CHECK_BILL" },
        ],
      })

      // act
      const result = await acknowledgeAllNotifications()

      // assert
      expect(result.ok).toBe(true)
      expect(await testPrisma().notification.count({ where: { status: "PENDING" } })).toBe(0)
    })

    it("การ์ดแจ้งเตือนต้องมีเวลาเปิดโต๊ะของ session ไม่ใช่แค่เวลาที่แจ้ง (F12)", async () => {
      // arrange
      const { sessionId } = await openTable("39")
      await addItems(sessionId, [{ quantity: 1, unitPrice: "350.00" }])
      await testPrisma().notification.create({
        data: { storeId: TEST_STORE_ID, tableSessionId: sessionId, type: "CHECK_BILL" },
      })

      // act
      const cards = await listNotifications(TEST_STORE_ID)

      // assert
      expect(cards).toHaveLength(1)
      expect(cards[0].tableCode).toBe("39")
      expect(cards[0].openedAt).toBeInstanceOf(Date)
      expect(cards[0].createdAt).toBeInstanceOf(Date)
      expect(cards[0].sessionTotal).toBe(350)
    })
  })
})
