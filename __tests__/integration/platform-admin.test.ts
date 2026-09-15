import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createTestProduct,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  TEST_STORE_ID,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// ผู้ดูแลแพลตฟอร์ม (Phase 14a) — คนละแกนกับ StoreMember.role ไม่ผูกกับร้านใด
describe.skipIf(!dbReady)("ผู้ดูแลแพลตฟอร์ม — /admin/stores + setStoreStatus", () => {
  let setStoreStatus: typeof import("@/app/actions/admin").setStoreStatus
  let listStoresForAdmin: typeof import("@/lib/admin-queries").listStoresForAdmin
  let requireStore: () => Promise<unknown>

  beforeAll(async () => {
    ;({ setStoreStatus } = await import("@/app/actions/admin"))
    ;({ listStoresForAdmin } = await import("@/lib/admin-queries"))
    ;({ requireStore } = await import("@/lib/session"))
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner-a", "เจ้าของร้าน A", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้านทดสอบ B" })
    await ensureTestUser("owner-b", "เจ้าของร้าน B", { storeId: OTHER_STORE_ID, role: "OWNER" })
    // ผู้ดูแลแพลตฟอร์ม — ตั้งใจให้ "ไม่อยู่ในร้านใดเลย" เหมือนของจริง
    await ensureTestUser("platform", "ทีมแพลตฟอร์ม", { storeId: null, isPlatformAdmin: true })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  it("เจ้าของร้าน (ไม่ใช่ admin) เรียก setStoreStatus → ok:false และสถานะไม่เปลี่ยน", async () => {
    setTestUser("owner-a")
    setActiveTestStore(TEST_STORE_ID)
    const result = await setStoreStatus(makeFormData({ storeId: OTHER_STORE_ID, status: "SUSPENDED" }))
    expect(result.ok).toBe(false)
    expect((await testPrisma().store.findUniqueOrThrow({ where: { id: OTHER_STORE_ID } })).status).toBe("ACTIVE")
  })

  it("ยังไม่ล็อกอิน → ok:false", async () => {
    setTestUser(null)
    expect((await setStoreStatus(makeFormData({ storeId: OTHER_STORE_ID, status: "SUSPENDED" }))).ok).toBe(false)
  })

  it("admin ระงับร้าน → requireStore() ของสมาชิกร้านนั้นโยน STORE_SUSPENDED ทันที · ปลดระงับแล้วกลับมาใช้ได้", async () => {
    setTestUser("platform")
    const suspended = await setStoreStatus(makeFormData({ storeId: OTHER_STORE_ID, status: "SUSPENDED" }))
    expect(suspended.ok, JSON.stringify(suspended)).toBe(true)
    expect((await testPrisma().store.findUniqueOrThrow({ where: { id: OTHER_STORE_ID } })).status).toBe("SUSPENDED")

    setTestUser("owner-b")
    setActiveTestStore(OTHER_STORE_ID)
    await expect(requireStore()).rejects.toThrow("STORE_SUSPENDED")

    // ร้าน A ไม่กระทบ
    setTestUser("owner-a")
    setActiveTestStore(TEST_STORE_ID)
    await expect(requireStore()).resolves.toBeTruthy()

    setTestUser("platform")
    const restored = await setStoreStatus(makeFormData({ storeId: OTHER_STORE_ID, status: "ACTIVE" }))
    expect(restored.ok).toBe(true)

    setTestUser("owner-b")
    setActiveTestStore(OTHER_STORE_ID)
    await expect(requireStore()).resolves.toBeTruthy()
  })

  it("ระงับร้านที่ถูกระงับอยู่แล้ว / ปลดร้านที่ใช้งานอยู่ / ร้านไม่มีจริง / สถานะผิด → ok:false", async () => {
    setTestUser("platform")
    expect((await setStoreStatus(makeFormData({ storeId: OTHER_STORE_ID, status: "ACTIVE" }))).ok).toBe(false)
    await setStoreStatus(makeFormData({ storeId: OTHER_STORE_ID, status: "SUSPENDED" }))
    expect((await setStoreStatus(makeFormData({ storeId: OTHER_STORE_ID, status: "SUSPENDED" }))).ok).toBe(false)
    expect((await setStoreStatus(makeFormData({ storeId: "no-such-store", status: "SUSPENDED" }))).ok).toBe(false)
    expect((await setStoreStatus(makeFormData({ storeId: OTHER_STORE_ID, status: "DELETED" }))).ok).toBe(false)
  })

  it("listStoresForAdmin เห็นทุกร้านพร้อมสมาชิก/เจ้าของ/โต๊ะ/บิล/ยอดขาย และไม่นับบิลที่ void", async () => {
    const db = testPrisma()
    const product = await createTestProduct({ storeId: TEST_STORE_ID, quantity: 10 })
    await db.table.createMany({
      data: [
        { storeId: TEST_STORE_ID, code: "A1" },
        { storeId: TEST_STORE_ID, code: "A2" },
        { storeId: OTHER_STORE_ID, code: "B1" },
      ],
    })
    const sale = (n: string, total: string, status: "COMPLETED" | "VOIDED", storeId = TEST_STORE_ID) => ({
      storeId,
      saleNumber: n,
      status,
      subtotal: total,
      total,
      paymentMethod: "CASH" as const,
      amountReceived: total,
      cashierId: storeId === TEST_STORE_ID ? "owner-a" : "owner-b",
    })
    await db.sale.createMany({
      data: [sale("INV-000001", "100.00", "COMPLETED"), sale("INV-000002", "50.50", "COMPLETED"), sale("INV-000003", "999.00", "VOIDED")],
    })
    await db.sale.createMany({ data: [sale("INV-000001", "20.00", "COMPLETED", OTHER_STORE_ID)] })
    void product

    const rows = await listStoresForAdmin()
    const a = rows.find((r) => r.id === TEST_STORE_ID)
    const b = rows.find((r) => r.id === OTHER_STORE_ID)
    expect(a).toMatchObject({ memberCount: 1, ownerEmails: ["owner-a@example.com"], tableCount: 2, saleCount: 2, totalSales: 150.5, status: "ACTIVE" })
    expect(b).toMatchObject({ memberCount: 1, ownerEmails: ["owner-b@example.com"], tableCount: 1, saleCount: 1, totalSales: 20 })
    expect(a?.lastSaleAt).toBeInstanceOf(Date)
  })
})
