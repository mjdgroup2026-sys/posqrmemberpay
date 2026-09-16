import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { DAY_MS } from "@/lib/subscription"
import {
  createTestMenuItem,
  createTestTable,
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
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()
const days = (n: number, from = Date.now()) => new Date(from + n * DAY_MS)
const closeTo = (actual: Date | null, expected: Date) => {
  expect(actual).not.toBeNull()
  if (actual) expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(10_000)
}

/// สาขาที่สาม (นอกเหนือจาก A/B ของ helper) — ไว้เป็นสาขาของแบรนด์อีกเจ้า
const THIRD_STORE_ID = "store_test_c"

/// ร้านหลายสาขา — Brand (Phase 14c): เจ้าของแบรนด์เข้าทุกสาขาเป็น OWNER · แบรนด์อื่นเข้าไม่ได้ · คัดลอกเมนูเป็นสำเนาอิสระ
/// · ใบจ่ายรวมยืนยันทั้งใบหรือไม่เลย + กดพร้อมกันผ่านครั้งเดียว (แตะเงิน → ต้องมีเทส concurrent ตามกติกาข้อ 7/9)
describe.skipIf(!dbReady)("ร้านหลายสาขา — Brand (Phase 14c)", () => {
  let brand: typeof import("@/app/actions/brand")
  let admin: typeof import("@/app/actions/admin-billing")
  let billing: typeof import("@/app/actions/billing")
  let onboarding: typeof import("@/app/actions/onboarding")
  let storeMembers: typeof import("@/app/actions/store-members")
  let session: typeof import("@/lib/session")
  let brandQueries: typeof import("@/lib/brand-queries")

  beforeAll(async () => {
    brand = await import("@/app/actions/brand")
    admin = await import("@/app/actions/admin-billing")
    billing = await import("@/app/actions/billing")
    onboarding = await import("@/app/actions/onboarding")
    storeMembers = await import("@/app/actions/store-members")
    session = await import("@/lib/session")
    brandQueries = await import("@/lib/brand-queries")
  })

  beforeEach(async () => {
    await resetDb()
    // owner-a เป็นเจ้าของร้าน A และ B (สองสาขาของตัวเอง) · owner-c เป็นเจ้าของร้าน C (แบรนด์อีกเจ้า)
    await ensureTestStore({ id: TEST_STORE_ID, plan: "none" })
    await ensureTestStore({ id: OTHER_STORE_ID, name: "สาขา B", plan: "none" })
    await ensureTestStore({ id: THIRD_STORE_ID, slug: "test-c", name: "ร้านของคนอื่น", plan: "none" })
    await ensureTestUser("owner-a", "เจ้าของ A", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestUser("owner-a", "เจ้าของ A", { storeId: OTHER_STORE_ID, role: "OWNER" })
    await ensureTestUser("owner-c", "เจ้าของ C", { storeId: THIRD_STORE_ID, role: "OWNER" })
    await ensureTestUser("staff-b", "พนักงาน B", { storeId: OTHER_STORE_ID, role: "STAFF" })
    await ensureTestUser("platform", "ทีมแพลตฟอร์ม", { storeId: null, isPlatformAdmin: true })
    setTestUser("owner-a")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// สร้างแบรนด์ของ owner-a ครอบ A + B แล้วคืน brandId
  async function brandAB(): Promise<string> {
    const fd = new FormData()
    fd.set("name", "แบรนด์ A")
    fd.append("storeIds", TEST_STORE_ID)
    fd.append("storeIds", OTHER_STORE_ID)
    const result = await brand.createBrand(fd)
    expect(result.ok, result.ok ? "" : result.error).toBe(true)
    return result.ok ? result.data!.brandId : ""
  }

  async function batchAB(planA = "S-D7", planB = "M-D30") {
    const fd = new FormData()
    fd.append("item", `${TEST_STORE_ID}|${planA}`)
    fd.append("item", `${OTHER_STORE_ID}|${planB}`)
    const result = await brand.requestBrandBatch(fd)
    expect(result.ok, result.ok ? "" : result.error).toBe(true)
    return testPrisma().subscriptionBatch.findFirstOrThrow({ where: { status: "PENDING" } })
  }

  describe("สร้างแบรนด์และดึงสาขา", () => {
    it("สร้างแบรนด์พร้อมดึงร้านที่ตัวเองเป็นเจ้าของเข้ามาในทรานแซคชันเดียว", async () => {
      const brandId = await brandAB()
      const stores = await testPrisma().store.findMany({ where: { brandId }, select: { id: true } })
      expect(stores.map((s) => s.id).sort()).toEqual([OTHER_STORE_ID, TEST_STORE_ID].sort())
    })

    it("1 บัญชี = 1 แบรนด์", async () => {
      await brandAB()
      const again = await brand.createBrand(makeFormData({ name: "อีกแบรนด์" }))
      expect(again.ok).toBe(false)
      expect(await testPrisma().brand.count()).toBe(1)
    })

    it("ดึงร้านของคนอื่นเข้าแบรนด์ไม่ได้ — ทั้งใบ rollback แม้มีร้านของตัวเองปนอยู่", async () => {
      const fd = new FormData()
      fd.set("name", "แบรนด์ A")
      fd.append("storeIds", TEST_STORE_ID)
      fd.append("storeIds", THIRD_STORE_ID)
      const result = await brand.createBrand(fd)
      expect(result.ok).toBe(false)
      expect(await testPrisma().brand.count()).toBe(0)
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).brandId).toBeNull()
    })

    it("ร้านที่อยู่ใต้แบรนด์อื่นแล้วดึงซ้ำไม่ได้ (updateMany where brandId null)", async () => {
      await brandAB()
      // owner-c สร้างแบรนด์ตัวเองแล้วพยายามดึง A — ไม่ใช่เจ้าของ A อยู่แล้ว → ปฏิเสธที่ด่านแรก
      setTestUser("owner-c")
      expect((await brand.createBrand(makeFormData({ name: "แบรนด์ C" }))).ok).toBe(true)
      const result = await brand.attachStoreToBrand(makeFormData({ storeId: TEST_STORE_ID }))
      expect(result.ok).toBe(false)
      // ส่วนเจ้าของเองที่เผลอดึงร้านที่อยู่ในแบรนด์แล้ว → count 0
      setTestUser("owner-a")
      const dup = await brand.attachStoreToBrand(makeFormData({ storeId: OTHER_STORE_ID }))
      expect(dup.ok).toBe(false)
    })
  })

  describe("เจ้าของแบรนด์ = OWNER ทุกสาขาใต้แบรนด์", () => {
    it("เข้าสาขาใต้แบรนด์ได้เป็น OWNER แม้ไม่มีแถว StoreMember", async () => {
      const brandId = await brandAB()
      // สาขาใหม่ใต้แบรนด์ที่ owner-a ไม่มี StoreMember เลย (เช่น ผู้ดูแลสร้างให้)
      await ensureTestStore({ id: "store_test_d", slug: "test-d", name: "สาขา D" })
      await testPrisma().store.update({ where: { id: "store_test_d" }, data: { brandId } })
      expect(await testPrisma().storeMember.count({ where: { userId: "owner-a", storeId: "store_test_d" } })).toBe(0)

      setActiveTestStore("store_test_d")
      const ctx = await session.requireOwner()
      expect(ctx.storeId).toBe("store_test_d")
      expect(ctx.role).toBe("OWNER")
      expect(ctx.brand).toEqual({ id: brandId, name: "แบรนด์ A", isOwner: true })
      const viaBrand = ctx.memberships.find((m) => m.storeId === "store_test_d")
      expect(viaBrand?.viaBrand).toBe(true)
      expect(viaBrand?.brandName).toBe("แบรนด์ A")

      // ตัวสลับร้านก็ต้องยอมให้สลับไป (เดิมเช็ค StoreMember ตรง ๆ)
      const switched = await storeMembers.switchActiveStore(makeFormData({ storeId: "store_test_d" }))
      expect(switched.ok).toBe(true)
    })

    it("พนักงาน (STAFF) ของสาขาใต้แบรนด์ที่บังเอิญเป็นเจ้าของแบรนด์ → ได้ OWNER (ความเป็นเจ้าของแบรนด์ชนะ)", async () => {
      const brandId = await brandAB()
      await ensureTestStore({ id: "store_test_d", slug: "test-d", name: "สาขา D" })
      await testPrisma().store.update({ where: { id: "store_test_d" }, data: { brandId } })
      await ensureTestUser("owner-a", "เจ้าของ A", { storeId: "store_test_d", role: "STAFF" })
      setActiveTestStore("store_test_d")
      expect((await session.requireStore()).role).toBe("OWNER")
    })

    it("เจ้าของแบรนด์ A เข้าสาขาของแบรนด์ B ไม่ได้", async () => {
      await brandAB()
      setTestUser("owner-c")
      expect((await brand.createBrand(makeFormData({ name: "แบรนด์ C" }))).ok).toBe(true)
      const brandC = await testPrisma().brand.findFirstOrThrow({ where: { ownerId: "owner-c" } })
      await testPrisma().store.update({ where: { id: THIRD_STORE_ID }, data: { brandId: brandC.id } })

      // owner-a ชี้ cookie ไปร้าน C → ตกกลับไปร้านแรกของตัวเอง ไม่ใช่ได้ร้าน C
      setTestUser("owner-a")
      setActiveTestStore(THIRD_STORE_ID)
      const ctx = await session.requireStore()
      expect(ctx.storeId).not.toBe(THIRD_STORE_ID)
      expect(ctx.memberships.some((m) => m.storeId === THIRD_STORE_ID)).toBe(false)
      expect((await storeMembers.switchActiveStore(makeFormData({ storeId: THIRD_STORE_ID }))).ok).toBe(false)

      // และ query ของแบรนด์ A ต้องไม่เห็นสาขา C
      const overview = await brandQueries.getBrandOverview("owner-a")
      expect(overview.stores.map((s) => s.id)).not.toContain(THIRD_STORE_ID)
    })

    it("พนักงานของสาขายังเป็น STAFF เหมือนเดิม ไม่ได้อะไรจากแบรนด์", async () => {
      await brandAB()
      setTestUser("staff-b")
      setActiveTestStore(OTHER_STORE_ID)
      const ctx = await session.requireStore()
      expect(ctx.role).toBe("STAFF")
      expect(ctx.brand?.isOwner).toBe(false)
      expect(ctx.memberships.map((m) => m.storeId)).toEqual([OTHER_STORE_ID])
    })
  })

  describe("คัดลอกเมนูข้ามสาขา", () => {
    async function seedMenuA() {
      const db = testPrisma()
      const item = await createTestMenuItem({ storeId: TEST_STORE_ID, name: "ผัดไทย", price: "80.00" })
      await db.modifierGroup.create({
        data: {
          storeId: TEST_STORE_ID,
          menuItemId: item.id,
          name: "ขนาด",
          selectionType: "SINGLE",
          required: true,
          options: { create: [{ name: "ธรรมดา", priceDelta: "0.00" }, { name: "พิเศษ", priceDelta: "20.00", sortOrder: 1 }] },
        },
      })
      await createTestMenuItem({ storeId: TEST_STORE_ID, name: "ชาไทย", price: "35.00" })
      await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "เลิกขายแล้ว", price: "1.00", isActive: false } })
      return item
    }

    it("ได้สำเนาอิสระ — แก้ราคาที่ปลายทางไม่กระทบต้นทาง และตัวเลือกเสริมติดไปด้วย", async () => {
      await brandAB()
      const source = await seedMenuA()
      setActiveTestStore(OTHER_STORE_ID)
      const result = await brand.copyMenuFromStore(makeFormData({ sourceStoreId: TEST_STORE_ID }))
      expect(result.ok, result.ok ? "" : result.error).toBe(true)
      if (result.ok) expect(result.data).toEqual({ copied: 2, skipped: 0 })

      const db = testPrisma()
      const copies = await db.menuItem.findMany({ where: { storeId: OTHER_STORE_ID }, include: { modifierGroups: { include: { options: true } } } })
      expect(copies.map((m) => m.name).sort()).toEqual(["ชาไทย", "ผัดไทย"])
      const padThai = copies.find((m) => m.name === "ผัดไทย")!
      expect(padThai.id).not.toBe(source.id)
      expect(padThai.modifierGroups).toHaveLength(1)
      expect(padThai.modifierGroups[0].storeId).toBe(OTHER_STORE_ID)
      expect(padThai.modifierGroups[0].options.map((o) => o.name).sort()).toEqual(["ธรรมดา", "พิเศษ"])

      await db.menuItem.update({ where: { id: padThai.id }, data: { price: "99.00" } })
      expect(Number((await db.menuItem.findUniqueOrThrow({ where: { id: source.id } })).price)).toBe(80)
      // รายการที่เลิกขายไม่ติดไป
      expect(await db.menuItem.count({ where: { storeId: OTHER_STORE_ID, name: "เลิกขายแล้ว" } })).toBe(0)
    })

    it("เรียกซ้ำข้ามรายการชื่อซ้ำ ไม่ทับของเดิม", async () => {
      await brandAB()
      await seedMenuA()
      await createTestMenuItem({ storeId: OTHER_STORE_ID, name: "ผัดไทย", price: "120.00" })
      setActiveTestStore(OTHER_STORE_ID)
      const result = await brand.copyMenuFromStore(makeFormData({ sourceStoreId: TEST_STORE_ID }))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data).toEqual({ copied: 1, skipped: 1 })
      const padThai = await testPrisma().menuItem.findFirstOrThrow({ where: { storeId: OTHER_STORE_ID, name: "ผัดไทย" } })
      expect(Number(padThai.price)).toBe(120)
    })

    it("คัดลอกจากร้านที่ไม่ได้เป็นเจ้าของไม่ได้ · ต้องเป็น OWNER ของร้านปลายทาง", async () => {
      await brandAB()
      await createTestMenuItem({ storeId: THIRD_STORE_ID, name: "เมนูของคนอื่น" })
      const foreign = await brand.copyMenuFromStore(makeFormData({ sourceStoreId: THIRD_STORE_ID }))
      expect(foreign.ok).toBe(false)
      expect(await testPrisma().menuItem.count({ where: { storeId: TEST_STORE_ID } })).toBe(0)

      setTestUser("staff-b")
      setActiveTestStore(OTHER_STORE_ID)
      expect((await brand.copyMenuFromStore(makeFormData({ sourceStoreId: TEST_STORE_ID }))).ok).toBe(false)
    })

    it("สร้างสาขาใหม่ใต้แบรนด์พร้อมคัดลอกเมนู — ไม่ใส่เมนูตัวอย่างซ้ำ", async () => {
      const brandId = await brandAB()
      await seedMenuA()
      const result = await onboarding.createStore(
        makeFormData({ name: "สาขาใหม่", slug: "new-branch", themeColor: "#E8571F", joinBrand: "on", copyMenuFromStoreId: TEST_STORE_ID }),
      )
      expect(result.ok, result.ok ? "" : result.error).toBe(true)
      const created = await testPrisma().store.findUniqueOrThrow({ where: { slug: "new-branch" }, include: { menuItems: true } })
      expect(created.brandId).toBe(brandId)
      expect(created.menuItems.map((m) => m.name).sort()).toEqual(["ชาไทย", "ผัดไทย"])
    })
  })

  describe("ใบจ่ายรวม (SubscriptionBatch)", () => {
    it("สร้างใบ: แถว PENDING รายสาขาผูก batchId เดียว · ยอดรวม = ผลรวมราคาแพ็กเกจ · สาขาเลือกแพ็กเกจต่างกันได้", async () => {
      await brandAB()
      const batch = await batchAB("S-D7", "M-D30")
      const rows = await testPrisma().storeSubscription.findMany({ where: { batchId: batch.id } })
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.status === "PENDING" && r.paymentReference === null)).toBe(true)
      expect(Number(batch.amount)).toBe(70 + 560)
      expect(batch.requestRef).toMatch(/^BAT-[2-9A-HJ-NP-Z]{6}$/)
      // ร้านยังไม่เปลี่ยน
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).planExpiresAt).toBeNull()
    })

    it("สาขาที่มีคำขอค้าง / โต๊ะเกินเพดาน / ไม่ได้อยู่ใต้แบรนด์ → ทั้งใบไม่ถูกสร้าง", async () => {
      await brandAB()
      // ร้าน A มีคำขอเดี่ยวค้าง
      expect((await billing.requestRenewal(makeFormData({ planCode: "S-D7" }))).ok).toBe(true)
      const fd = new FormData()
      fd.append("item", `${TEST_STORE_ID}|S-D7`)
      fd.append("item", `${OTHER_STORE_ID}|S-D7`)
      expect((await brand.requestBrandBatch(fd)).ok).toBe(false)
      expect(await testPrisma().subscriptionBatch.count()).toBe(0)
      expect(await testPrisma().storeSubscription.count({ where: { storeId: OTHER_STORE_ID } })).toBe(0)

      // โต๊ะเกินเพดาน S (12) ที่สาขา B
      for (let i = 0; i < 13; i += 1) await createTestTable(`B${i}`, OTHER_STORE_ID)
      const fd2 = new FormData()
      fd2.append("item", `${OTHER_STORE_ID}|S-D7`)
      expect((await brand.requestBrandBatch(fd2)).ok).toBe(false)

      // สาขาของคนอื่น
      const fd3 = new FormData()
      fd3.append("item", `${THIRD_STORE_ID}|S-D7`)
      expect((await brand.requestBrandBatch(fd3)).ok).toBe(false)
      expect(await testPrisma().subscriptionBatch.count()).toBe(0)
    })

    it("แถวในใบรวมยกเลิก/ยืนยันรายสาขาไม่ได้ — ต้องทั้งใบ", async () => {
      await brandAB()
      const batch = await batchAB()
      const rowA = await testPrisma().storeSubscription.findFirstOrThrow({ where: { batchId: batch.id, storeId: TEST_STORE_ID } })

      expect((await billing.cancelPendingRequest(makeFormData({ id: rowA.id }))).ok).toBe(false)
      setTestUser("platform")
      expect((await admin.confirmSubscription(makeFormData({ id: rowA.id, paymentReference: "TXN-ROW" }))).ok).toBe(false)
      expect((await admin.voidSubscription(makeFormData({ id: rowA.id, reason: "ลองถอยรายแถว" }))).ok).toBe(false)
      expect((await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: rowA.id } })).status).toBe("PENDING")
    })

    it("ผู้ดูแลยืนยันทั้งใบ → ทุกสาขามีผลพร้อมกัน stack ต่อท้ายของแต่ละสาขา · เลขธนาคารอยู่ที่หัวใบ", async () => {
      await brandAB()
      // สาขา B ยังเหลือ 10 วัน — ต้องต่อท้าย ไม่ใช่นับจากวันนี้
      await testPrisma().store.update({ where: { id: OTHER_STORE_ID }, data: { planTier: "S", tableLimit: 12, planExpiresAt: days(10) } })
      const batch = await batchAB("S-D7", "M-D30")

      setTestUser("platform")
      const result = await admin.confirmSubscriptionBatch(makeFormData({ batchId: batch.id, paymentReference: "TXN-BATCH-1" }))
      expect(result.ok, result.ok ? "" : result.error).toBe(true)

      const db = testPrisma()
      const head = await db.subscriptionBatch.findUniqueOrThrow({ where: { id: batch.id } })
      expect(head.status).toBe("PAID")
      expect(head.paymentReference).toBe("TXN-BATCH-1")
      const rows = await db.storeSubscription.findMany({ where: { batchId: batch.id } })
      expect(rows.every((r) => r.status === "PAID" && r.paymentReference === null)).toBe(true)

      const a = await db.store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })
      expect(a.planTier).toBe("S")
      closeTo(a.planExpiresAt, days(7))
      const b = await db.store.findUniqueOrThrow({ where: { id: OTHER_STORE_ID } })
      expect(b.planTier).toBe("M")
      expect(b.tableLimit).toBe(30)
      closeTo(b.planExpiresAt, days(40))

      // ยืนยันซ้ำด้วยเลขเดิม/ใหม่ → ไม่ผ่าน ไม่เพิ่มวันซ้ำ
      expect((await admin.confirmSubscriptionBatch(makeFormData({ batchId: batch.id, paymentReference: "TXN-BATCH-2" }))).ok).toBe(false)
      closeTo((await db.store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).planExpiresAt, days(7))
    })

    it("ทั้งใบหรือไม่เลย — สาขาหนึ่งเพิ่มโต๊ะเกินเพดานระหว่างรอ → ไม่มีสาขาใดเปลี่ยน", async () => {
      await brandAB()
      const batch = await batchAB("S-D7", "S-D7")
      for (let i = 0; i < 13; i += 1) await createTestTable(`B${i}`, OTHER_STORE_ID)

      setTestUser("platform")
      const result = await admin.confirmSubscriptionBatch(makeFormData({ batchId: batch.id, paymentReference: "TXN-HALF" }))
      expect(result.ok).toBe(false)

      const db = testPrisma()
      expect((await db.subscriptionBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("PENDING")
      const rows = await db.storeSubscription.findMany({ where: { batchId: batch.id } })
      expect(rows.every((r) => r.status === "PENDING")).toBe(true)
      expect((await db.store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).planExpiresAt).toBeNull()
      expect((await db.store.findUniqueOrThrow({ where: { id: OTHER_STORE_ID } })).planExpiresAt).toBeNull()
    })

    it("★ ยืนยันใบเดียวกันพร้อมกัน 5 ครั้ง → ผ่านครั้งเดียว วันไม่ถูกเพิ่มซ้ำ", async () => {
      await brandAB()
      const batch = await batchAB("S-D7", "S-D7")
      setTestUser("platform")
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => admin.confirmSubscriptionBatch(makeFormData({ batchId: batch.id, paymentReference: `TXN-RACE-${i}` }))),
      )
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      const db = testPrisma()
      closeTo((await db.store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).planExpiresAt, days(7))
      closeTo((await db.store.findUniqueOrThrow({ where: { id: OTHER_STORE_ID } })).planExpiresAt, days(7))
      expect(await db.storeSubscription.count({ where: { batchId: batch.id, status: "PAID" } })).toBe(2)
    })

    it("เจ้าของแบรนด์ยกเลิกทั้งใบได้เฉพาะตอนยัง PENDING · แบรนด์อื่นยกเลิกไม่ได้", async () => {
      await brandAB()
      const batch = await batchAB()
      setTestUser("owner-c")
      expect((await brand.cancelBrandBatch(makeFormData({ batchId: batch.id }))).ok).toBe(false)
      setTestUser("owner-a")
      expect((await brand.cancelBrandBatch(makeFormData({ batchId: batch.id }))).ok).toBe(true)
      const db = testPrisma()
      expect((await db.subscriptionBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("VOID")
      expect(await db.storeSubscription.count({ where: { batchId: batch.id, status: "VOID" } })).toBe(2)
      // ยกเลิกแล้วขอใหม่ได้
      await batchAB()
    })

    it("ผู้ดูแลยกเลิกใบ PENDING ได้ · ใบที่ PAID แล้วยกเลิกทั้งใบไม่ได้ (ต้องถอยรายสาขา)", async () => {
      await brandAB()
      const batch = await batchAB()
      setTestUser("platform")
      expect((await admin.confirmSubscriptionBatch(makeFormData({ batchId: batch.id, paymentReference: "TXN-PAID" }))).ok).toBe(true)
      expect((await admin.voidSubscriptionBatch(makeFormData({ batchId: batch.id, reason: "ลองยกเลิกใบที่จ่ายแล้ว" }))).ok).toBe(false)

      // ถอยรายสาขาผ่านแถวลูก (ledger append-only เดิม) ยังทำได้
      const rowA = await testPrisma().storeSubscription.findFirstOrThrow({ where: { batchId: batch.id, storeId: TEST_STORE_ID } })
      expect((await admin.voidSubscription(makeFormData({ id: rowA.id, reason: "โอนผิด" }))).ok).toBe(true)
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })).planExpiresAt).toBeNull()
      // สาขา B ไม่ถูกแตะ
      closeTo((await testPrisma().store.findUniqueOrThrow({ where: { id: OTHER_STORE_ID } })).planExpiresAt, days(30))

      setTestUser("owner-a")
      const batch2 = await batchAB()
      setTestUser("platform")
      expect((await admin.voidSubscriptionBatch(makeFormData({ batchId: batch2.id, reason: "ร้านขอยกเลิก" }))).ok).toBe(true)
      expect(await testPrisma().storeSubscription.count({ where: { batchId: batch2.id, status: "VOID" } })).toBe(2)
    })

    it("ผู้ที่ไม่ใช่ผู้ดูแลแพลตฟอร์มยืนยัน/ยกเลิกใบไม่ได้", async () => {
      await brandAB()
      const batch = await batchAB()
      expect((await admin.confirmSubscriptionBatch(makeFormData({ batchId: batch.id, paymentReference: "TXN-OWNER" }))).ok).toBe(false)
      expect((await admin.voidSubscriptionBatch(makeFormData({ batchId: batch.id, reason: "เจ้าของลองยกเลิก" }))).ok).toBe(false)
      expect((await testPrisma().subscriptionBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("PENDING")
    })
  })
})
