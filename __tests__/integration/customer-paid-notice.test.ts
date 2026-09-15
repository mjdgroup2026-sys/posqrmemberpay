import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestMenuItem,
  createTestOrder,
  createTestOrderItem,
  createTestQrCode,
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// ป้าย "ลูกค้าชำระเงินแล้วเรียบร้อยเมื่อเวลา…" บนหน้าจอพนักงาน
///
/// callback ของธนาคารปิดบิลแล้วคืนโต๊ะเป็นว่างในทรานแซคชันเดียวกัน พนักงานที่เฝ้าผังโต๊ะจึงเห็น
/// แค่โต๊ะหายไป ไม่มีอะไรบอกว่าเงินเข้าครบแล้ว — ป้ายนี้คือคำตอบนั้น และต้องคำนวณสด (หายเอง)
describe.skipIf(!dbReady)("แจ้งพนักงานเมื่อลูกค้าชำระเงินเองสำเร็จ", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let closeSessionWithPayment: typeof import("@/lib/close-session").closeSessionWithPayment
  let listCustomerPaidBills: typeof import("@/lib/queries").listCustomerPaidBills

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const closeSession = await import("@/lib/close-session")
    const queries = await import("@/lib/queries")
    openTableSession = tables.openTableSession
    closeSessionWithPayment = closeSession.closeSessionWithPayment
    listCustomerPaidBills = queries.listCustomerPaidBills
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "0.00" })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function seedSessionWithBill() {
    const table = await createTestTable()
    const qr = await createTestQrCode(table.id, { type: "DYNAMIC" })
    const opened = await openTableSession(makeFormData({ qrToken: qr.token }))
    expect(opened.ok).toBe(true)
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""

    const menu = await createTestMenuItem({ name: "ข้าวกะเพราหมู", price: "130.00" })
    const order = await createTestOrder(sessionId)
    await createTestOrderItem(order.id, menu.id, { quantity: 2, unitPrice: "130.00" })

    return { table, sessionId }
  }

  /// ย้อนเวลาปิดบิล — เร็วกว่ารอจริงจนป้ายหมดอายุ
  async function backdateSale(saleId: string, minutesAgo: number) {
    await testPrisma().sale.update({
      where: { id: saleId },
      data: { createdAt: new Date(Date.now() - minutesAgo * 60_000) },
    })
  }

  it("callback ปิดบิลให้เอง → ขึ้นป้ายพร้อมโต๊ะ เวลาที่ชำระ ยอด และเลขบิล", async () => {
    const { table, sessionId } = await seedSessionWithBill()
    const before = Date.now()

    const closed = await closeSessionWithPayment({
      storeId: TEST_STORE_ID,
      sessionId,
      paymentMethod: "PROMPTPAY",
      paymentReference: "SCBTX-PAID-1",
      amountReceived: 260,
      verifiedAmount: 260,
    })
    expect(closed.ok).toBe(true)

    const rows = await listCustomerPaidBills(TEST_STORE_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tableCode).toBe(table.code)
    expect(rows[0]?.tableId).toBe(table.id)
    expect(rows[0]?.total).toBe(260)
    expect(rows[0]?.paymentMethod).toBe("PROMPTPAY")
    // เวลาที่แสดงต้องเป็นเวลาที่ปิดบิลจริง ไม่ใช่เวลาที่เปิดหน้าจอ
    expect(rows[0]?.paidAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(rows[0]?.saleNumber).toBe(closed.ok === true ? closed.saleNumber : "")
  })

  /// เดิมกรองบิลแบบนี้ทิ้ง แล้วเจ้าของระบบเจอจริงว่าเคสจ่ายหลัง QR หมดอายุจบด้วยพนักงานกดปิดเอง
  /// จอเลยไม่ขึ้นอะไรเลยทั้งที่ลูกค้าจ่ายแล้ว — ต้องขึ้นเหมือนกัน เพียงแต่บอกว่าใครเป็นคนปิด
  it("พนักงานกดปิดบิลเอง → ขึ้นป้ายเหมือนกัน พร้อมบอกว่าใครปิด", async () => {
    const { table, sessionId } = await seedSessionWithBill()

    const closed = await closeSessionWithPayment({
      storeId: TEST_STORE_ID,
      sessionId,
      paymentMethod: "CASH",
      cashierId: "test-user",
      amountReceived: 300,
    })
    expect(closed.ok).toBe(true)

    const rows = await listCustomerPaidBills(TEST_STORE_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tableId).toBe(table.id)
    expect(rows[0]?.autoClosed).toBe(false)
    expect(rows[0]?.closedByName).toBe("ผู้ทดสอบ")
  })

  it("บิลที่ระบบปิดเองต้องไม่ถูกติดป้ายว่าพนักงานปิด", async () => {
    const { sessionId } = await seedSessionWithBill()

    const closed = await closeSessionWithPayment({
      storeId: TEST_STORE_ID,
      sessionId,
      paymentMethod: "PROMPTPAY",
      paymentReference: "SCBTX-AUTO-1",
      amountReceived: 260,
      verifiedAmount: 260,
    })
    expect(closed.ok).toBe(true)

    const rows = await listCustomerPaidBills(TEST_STORE_ID)
    expect(rows[0]?.autoClosed).toBe(true)
    expect(rows[0]?.closedByName).toBeNull()
  })

  it("ป้ายหายเองเมื่อพ้น 30 นาที ไม่ต้องมีใครมากดรับทราบ", async () => {
    const { sessionId } = await seedSessionWithBill()

    const closed = await closeSessionWithPayment({
      storeId: TEST_STORE_ID,
      sessionId,
      paymentMethod: "PROMPTPAY",
      paymentReference: "SCBTX-PAID-2",
      amountReceived: 260,
      verifiedAmount: 260,
    })
    expect(closed.ok).toBe(true)
    const saleId = closed.ok === true ? closed.saleId : ""

    await backdateSale(saleId, 29)
    expect(await listCustomerPaidBills(TEST_STORE_ID)).toHaveLength(1)

    await backdateSale(saleId, 31)
    expect(await listCustomerPaidBills(TEST_STORE_ID)).toHaveLength(0)
  })
})
