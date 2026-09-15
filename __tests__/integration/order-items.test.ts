import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestMenuItem,
  createTestOrder,
  createTestOrderItem,
  createTestTable,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
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

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const orders = await import("@/app/actions/orders")
    openTableSession = tables.openTableSession
    cancelOrderItem = orders.cancelOrderItem
    startCookingItem = orders.startCookingItem
    markItemReady = orders.markItemReady
    markItemServed = orders.markItemServed
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function seedItem(status: "AWAITING_KITCHEN" | "COOKING" | "READY" = "AWAITING_KITCHEN") {
    const table = await createTestTable()
    const opened = await openTableSession(makeFormData({ tableId: table.id }))
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""
    const menuItem = await createTestMenuItem({ name: `เมนู-${Math.random().toString(36).slice(2, 8)}` })
    const order = await createTestOrder(sessionId)
    const item = await createTestOrderItem(order.id, menuItem.id, { status })
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
