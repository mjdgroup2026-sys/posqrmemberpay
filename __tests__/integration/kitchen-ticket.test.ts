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
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("ทิกเก็ตครัวแบบพิมพ์ผ่านเครื่องพิมพ์ PDF (Phase 8)", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let markTicketPrinted: (formData: FormData) => Promise<ActionResult>
  let reprintKitchenTicket: (formData: FormData) => Promise<ActionResult>
  let getKitchenTicket: typeof import("@/lib/queries").getKitchenTicket

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const orders = await import("@/app/actions/orders")
    const queries = await import("@/lib/queries")
    openTableSession = tables.openTableSession
    markTicketPrinted = orders.markTicketPrinted
    reprintKitchenTicket = orders.reprintKitchenTicket
    getKitchenTicket = queries.getKitchenTicket
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
    await setStoreSettings({ hasKDS: true, serviceChargePercent: "0.00" })
    delete process.env.KITCHEN_PRINTER_HOST
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function seedOrder() {
    const db = testPrisma()
    const table = await createTestTable()
    const opened = await openTableSession(makeFormData({ tableId: table.id }))
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""

    const menu = await createTestMenuItem({ name: "ผัดไทยกุ้งสด", price: "120.00" })
    const order = await createTestOrder(sessionId)
    await createTestOrderItem(order.id, menu.id, { quantity: 2, unitPrice: "120.00" })

    const cancelled = await createTestOrderItem(order.id, menu.id, { quantity: 9, unitPrice: "120.00" })
    await db.mobileOrderItem.update({
      where: { id: cancelled.id },
      data: { status: "CANCELLED", cancelReason: "ลูกค้าเปลี่ยนใจ" },
    })

    return { table, order, sessionId }
  }

  it("ทิกเก็ตมีข้อมูลครบและไม่รวมรายการที่ถูกยกเลิก", async () => {
    const { table, order } = await seedOrder()

    const ticket = await getKitchenTicket(TEST_STORE_ID, order.id)
    expect(ticket).not.toBeNull()
    expect(ticket?.tableCode).toBe(table.code)
    expect(ticket?.orderNumber).toBe(1)
    expect(ticket?.storeName).toBe("ร้านทดสอบ test-a")
    expect(ticket?.printedAt).toBeNull()
    // ครัวต้องไม่เห็นของที่ไม่ต้องทำ
    expect(ticket?.items).toHaveLength(1)
    expect(ticket?.items[0]).toMatchObject({ name: "ผัดไทยกุ้งสด", quantity: 2 })
  })

  it("ออร์เดอร์ที่ไม่มีอยู่จริงต้องคืน null ไม่ใช่ throw", async () => {
    expect(await getKitchenTicket(TEST_STORE_ID, "ไม่มีอยู่จริง")).toBeNull()
  })

  it("กดพิมพ์แล้วประทับ printedAt และกดซ้ำไม่เลื่อนเวลาเดิม", async () => {
    const db = testPrisma()
    const { order } = await seedOrder()

    const first = await markTicketPrinted(makeFormData({ id: order.id }))
    expect(first.ok).toBe(true)
    const stamped = (await db.mobileOrder.findUnique({ where: { id: order.id } }))?.printedAt
    expect(stamped).not.toBeNull()

    const second = await markTicketPrinted(makeFormData({ id: order.id }))
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.message).toContain("เคยพิมพ์")

    const after = (await db.mobileOrder.findUnique({ where: { id: order.id } }))?.printedAt
    expect(after?.getTime()).toBe(stamped?.getTime())
  })

  it("ยังไม่ล็อกอินสั่งประทับไม่ได้", async () => {
    const { order } = await seedOrder()
    setTestUser(null)

    const result = await markTicketPrinted(makeFormData({ id: order.id }))
    expect(result.ok).toBe(false)
    setTestUser("test-user")
    expect((await testPrisma().mobileOrder.findUnique({ where: { id: order.id } }))?.printedAt).toBeNull()
  })

  it("ไม่ได้ต่อเครื่องพิมพ์ความร้อน = ปุ่มส่งเข้าเครื่องพิมพ์บอกให้ไปใช้ทิกเก็ต PDF แทน", async () => {
    const { order } = await seedOrder()

    const result = await reprintKitchenTicket(makeFormData({ id: order.id }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ทิกเก็ต PDF")
  })
})
