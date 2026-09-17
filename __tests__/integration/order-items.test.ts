import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestMenuItem,
  createTestOrder,
  createTestOrderItem,
  createTestTable,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  setStoreSettings,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("สถานะรายการอาหารและการยกเลิกรายรายการ (Phase 8)", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let cancelOrderItem: (formData: FormData) => Promise<ActionResult>
  let startCookingItem: (formData: FormData) => Promise<ActionResult>
  let markItemReady: (formData: FormData) => Promise<ActionResult>
  let markItemServed: (formData: FormData) => Promise<ActionResult>
  let reduceOrderItemQuantity: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const orders = await import("@/app/actions/orders")
    openTableSession = tables.openTableSession
    cancelOrderItem = orders.cancelOrderItem
    startCookingItem = orders.startCookingItem
    markItemReady = orders.markItemReady
    markItemServed = orders.markItemServed
    reduceOrderItemQuantity = orders.reduceOrderItemQuantity
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function seedItem(status: "AWAITING_KITCHEN" | "COOKING" | "READY" = "AWAITING_KITCHEN", quantity = 1) {
    const table = await createTestTable()
    const opened = await openTableSession(makeFormData({ tableId: table.id }))
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""
    const menuItem = await createTestMenuItem({ name: `เมนู-${Math.random().toString(36).slice(2, 8)}` })
    const order = await createTestOrder(sessionId)
    const item = await createTestOrderItem(order.id, menuItem.id, { status, quantity })
    return { table, sessionId, order, item }
  }

  describe("ยกเลิกรายการอาหาร (กติกาข้อ 7)", () => {
    it("ยกเลิกได้ตอนยังรอครัวรับ และบันทึกผู้ยกเลิกกับเหตุผล", async () => {
      // arrange
      await setStoreSettings({ hasKDS: true })
      const { item } = await seedItem("AWAITING_KITCHEN")

      // act
      const result = await cancelOrderItem(makeFormData({ id: item.id, reason: "ลูกค้าเปลี่ยนใจ" }))

      // assert
      expect(result.ok).toBe(true)
      const after = await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })
      expect(after.status).toBe("CANCELLED")
      expect(after.cancelledById).toBe("test-user")
      expect(after.cancelReason).toBe("ลูกค้าเปลี่ยนใจ")
      expect(after.cancelledAt).not.toBeNull()
    })

    it("ยกเลิกหลังครัวเริ่มทำแล้วต้องถูกปฏิเสธเสมอ", async () => {
      // arrange
      await setStoreSettings({ hasKDS: true })
      const { item } = await seedItem("COOKING")

      // act
      const result = await cancelOrderItem(makeFormData({ id: item.id, reason: "ขอยกเลิก" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("กำลังปรุง")

      const after = await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })
      expect(after.status).toBe("COOKING")
    })

    it("ยกเลิกโดยไม่ระบุเหตุผลต้องถูกปฏิเสธ", async () => {
      // arrange
      await setStoreSettings({ hasKDS: true })
      const { item } = await seedItem()

      // act
      const result = await cancelOrderItem(makeFormData({ id: item.id, reason: "" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("กรุณาระบุเหตุผลที่ยกเลิกรายการ")
    })

    it("★ ยกเลิกพร้อมกับครัวกดเริ่มทำ — ต้องสำเร็จแค่ฝั่งเดียวเสมอ (concurrent)", async () => {
      // arrange
      await setStoreSettings({ hasKDS: true })
      const { item } = await seedItem("AWAITING_KITCHEN")

      // act — ยิงพร้อมกันจริง ๆ
      const [cancelResult, cookResult] = await Promise.all([
        cancelOrderItem(makeFormData({ id: item.id, reason: "ยกเลิกพร้อมกัน" })),
        startCookingItem(makeFormData({ id: item.id })),
      ])

      // assert — ต้องมีฝั่งที่สำเร็จเพียงฝั่งเดียว และสถานะปลายทางต้องสอดคล้องกับผู้ชนะ
      const winners = [cancelResult, cookResult].filter((r) => r.ok)
      expect(winners).toHaveLength(1)

      const after = await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })
      if (cancelResult.ok) {
        expect(after.status).toBe("CANCELLED")
        expect(after.cancelReason).toBe("ยกเลิกพร้อมกัน")
      } else {
        expect(after.status).toBe("COOKING")
        expect(after.cancelReason).toBeNull()
      }
    })

    it("ยิงยกเลิกซ้ำ 5 ครั้งพร้อมกันต้องสำเร็จครั้งเดียว", async () => {
      // arrange
      await setStoreSettings({ hasKDS: true })
      const { item } = await seedItem()

      // act
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          cancelOrderItem(makeFormData({ id: item.id, reason: "ยิงซ้ำ" })),
        ),
      )

      // assert
      expect(results.filter((r) => r.ok)).toHaveLength(1)
    })
  })

  /// ลดจำนวนหลังส่งครัว (F13 — ตัดสินใจ 2026-09-17): ได้เฉพาะรายการที่ครัวยังไม่รับ · ทำแบบ ledger
  /// (ยกเลิกแถวเดิม + สร้างแถวใหม่) · สิทธิ์เดียวกับยกเลิกรายการ · เพิ่มจำนวน = สั่งเพิ่มเป็นรอบใหม่ (ไม่มี action)
  describe("ลดจำนวนรายการอาหาร (F13)", () => {
    it("ลดได้ตอนยังรอครัวรับ — แถวเดิมถูกยกเลิกพร้อมบันทึกใคร/จากเท่าไร และมีแถวใหม่ตามจำนวนใหม่", async () => {
      await setStoreSettings({ hasKDS: true })
      const { item, order } = await seedItem("AWAITING_KITCHEN", 3)

      const result = await reduceOrderItemQuantity(makeFormData({ id: item.id, quantity: "1" }))

      expect(result.ok).toBe(true)
      const db = testPrisma()
      const old = await db.mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })
      expect(old.status).toBe("CANCELLED")
      expect(old.quantity).toBe(3) // แถวเดิมไม่ถูกแก้ทับ — ประวัติยังอ่านได้
      expect(old.cancelledById).toBe("test-user")
      expect(old.cancelReason).toBe("ลดจำนวนจาก 3 เป็น 1")

      const live = await db.mobileOrderItem.findMany({ where: { mobileOrderId: order.id, status: "AWAITING_KITCHEN" } })
      expect(live).toHaveLength(1)
      expect(live[0].quantity).toBe(1)
      expect(live[0].menuItemId).toBe(item.menuItemId)
      expect(Number(live[0].unitPrice)).toBe(Number(item.unitPrice))
    })

    it("ครัวเริ่มทำแล้ว → ลดไม่ได้ และไม่มีแถวใหม่เกิดขึ้น", async () => {
      await setStoreSettings({ hasKDS: true })
      const { item, order } = await seedItem("COOKING", 3)

      const result = await reduceOrderItemQuantity(makeFormData({ id: item.id, quantity: "1" }))

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("ครัวรับรายการนี้ไปแล้ว")
      expect(await testPrisma().mobileOrderItem.count({ where: { mobileOrderId: order.id } })).toBe(1)
    })

    it("จำนวนใหม่ต้องน้อยกว่าเดิม — เท่าเดิม/มากกว่า/ศูนย์ ถูกปฏิเสธ", async () => {
      await setStoreSettings({ hasKDS: true })
      const { item, order } = await seedItem("AWAITING_KITCHEN", 2)

      for (const quantity of ["2", "5", "0"]) {
        const result = await reduceOrderItemQuantity(makeFormData({ id: item.id, quantity }))
        expect(result.ok, `quantity=${quantity}`).toBe(false)
      }
      expect(await testPrisma().mobileOrderItem.count({ where: { mobileOrderId: order.id } })).toBe(1)
    })

    it("★ ลดจำนวนพร้อมกับครัวกดเริ่มทำ — สำเร็จแค่ฝั่งเดียว และไม่มีแถวกำพร้า (concurrent)", async () => {
      await setStoreSettings({ hasKDS: true })
      const { item, order } = await seedItem("AWAITING_KITCHEN", 3)

      const [reduceResult, cookResult] = await Promise.all([
        reduceOrderItemQuantity(makeFormData({ id: item.id, quantity: "2" })),
        startCookingItem(makeFormData({ id: item.id })),
      ])

      expect([reduceResult, cookResult].filter((r) => r.ok)).toHaveLength(1)
      const rows = await testPrisma().mobileOrderItem.findMany({ where: { mobileOrderId: order.id } })
      if (reduceResult.ok) {
        expect(rows).toHaveLength(2)
        expect(rows.find((r) => r.id === item.id)?.status).toBe("CANCELLED")
        expect(rows.find((r) => r.id !== item.id)?.quantity).toBe(2)
      } else {
        expect(rows).toHaveLength(1)
        expect(rows[0].status).toBe("COOKING")
      }
    })

    it("รายการของร้านอื่นลดไม่ได้ แม้จำนวนจะถูกต้อง (แยกข้อมูลตามร้าน)", async () => {
      // fixture ของ tenant-isolation มีจำนวน 1 จึงแยกไม่ออกว่าติดด่านไหน — เทสนี้ให้ร้าน B มี 3 แล้วขอลดเหลือ 1
      await setStoreSettings({ hasKDS: true })
      await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้าน B" })
      const db = testPrisma()
      const tableB = await createTestTable("B1", OTHER_STORE_ID)
      const sessionB = await db.tableSession.create({ data: { storeId: OTHER_STORE_ID, tableId: tableB.id } })
      const menuB = await createTestMenuItem({ name: "เมนูร้าน B", storeId: OTHER_STORE_ID })
      const orderB = await db.mobileOrder.create({ data: { storeId: OTHER_STORE_ID, tableSessionId: sessionB.id, orderNumber: 1 } })
      const itemB = await createTestOrderItem(orderB.id, menuB.id, { quantity: 3 })

      const result = await reduceOrderItemQuantity(makeFormData({ id: itemB.id, quantity: "1" }))

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe("ไม่พบรายการอาหารนี้")
      const rows = await db.mobileOrderItem.findMany({ where: { mobileOrderId: orderB.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe("AWAITING_KITCHEN")
    })

    it("ยิงลดซ้ำ 5 ครั้งพร้อมกันต้องสำเร็จครั้งเดียว — ไม่เกิดแถวใหม่ซ้อนกัน", async () => {
      await setStoreSettings({ hasKDS: true })
      const { item, order } = await seedItem("AWAITING_KITCHEN", 5)

      const results = await Promise.all(
        Array.from({ length: 5 }, () => reduceOrderItemQuantity(makeFormData({ id: item.id, quantity: "1" }))),
      )

      expect(results.filter((r) => r.ok)).toHaveLength(1)
      const rows = await testPrisma().mobileOrderItem.findMany({ where: { mobileOrderId: order.id } })
      expect(rows).toHaveLength(2)
      expect(rows.filter((r) => r.status === "AWAITING_KITCHEN")).toHaveLength(1)
    })
  })

  describe("เส้นทางสถานะเมื่อมี KDS", () => {
    it("รอครัวรับ → กำลังปรุง → พร้อมเสิร์ฟ → เสิร์ฟแล้ว", async () => {
      // arrange
      await setStoreSettings({ hasKDS: true })
      const { item } = await seedItem()

      // act + assert
      expect((await startCookingItem(makeFormData({ id: item.id }))).ok).toBe(true)
      expect((await markItemReady(makeFormData({ id: item.id }))).ok).toBe(true)
      expect((await markItemServed(makeFormData({ id: item.id }))).ok).toBe(true)

      const after = await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })
      expect(after.status).toBe("SERVED")
    })

    it("ข้ามขั้นจากรอครัวรับไปพร้อมเสิร์ฟไม่ได้", async () => {
      // arrange
      await setStoreSettings({ hasKDS: true })
      const { item } = await seedItem()

      // act
      const result = await markItemReady(makeFormData({ id: item.id }))

      // assert
      expect(result.ok).toBe(false)
      const after = await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })
      expect(after.status).toBe("AWAITING_KITCHEN")
    })

    it("ร้านที่มี KDS ต้องกดเสิร์ฟจากสถานะพร้อมเสิร์ฟเท่านั้น", async () => {
      // arrange
      await setStoreSettings({ hasKDS: true })
      const { item } = await seedItem("AWAITING_KITCHEN")

      // act
      const result = await markItemServed(makeFormData({ id: item.id }))

      // assert
      expect(result.ok).toBe(false)
    })
  })

  describe("เส้นทางสถานะเมื่อไม่มี KDS (fallback)", () => {
    it("กด “เสิร์ฟอาหารแล้ว” จากรอครัวรับได้ตรง ๆ", async () => {
      // arrange
      await setStoreSettings({ hasKDS: false })
      const { item } = await seedItem("AWAITING_KITCHEN")

      // act
      const result = await markItemServed(makeFormData({ id: item.id }))

      // assert
      expect(result.ok).toBe(true)
      const after = await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })
      expect(after.status).toBe("SERVED")
    })

    it("กด “เริ่มปรุง” ไม่ได้เพราะร้านปิด KDS", async () => {
      // arrange
      await setStoreSettings({ hasKDS: false })
      const { item } = await seedItem()

      // act
      const result = await startCookingItem(makeFormData({ id: item.id }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("KDS")
    })
  })
})
