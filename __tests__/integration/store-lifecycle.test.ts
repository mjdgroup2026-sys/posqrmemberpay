import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import { addTestMember, disconnectTestDb, ensureTestUser, isTestDbReachable, resetDb, TEST_STORE_ID, testPrisma } from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })),
}))

const dbReady = await isTestDbReachable()

/// ปิดร้าน / เปิดร้านอีกครั้ง / ลบร้านถาวร (2026-09-30) — lib/store-lifecycle.ts + app/actions/store-lifecycle.ts
describe.skipIf(!dbReady)("ปิด / เปิด / ลบร้าน", () => {
  let lifecycle: typeof import("@/app/actions/store-lifecycle")
  let createStore: typeof import("@/app/actions/onboarding").createStore
  let claimTrial: typeof import("@/app/actions/billing").claimTrial
  let closeCashierDay: (formData: FormData) => Promise<ActionResult>
  let switchActiveStore: typeof import("@/app/actions/store-members").switchActiveStore
  let queries: typeof import("@/lib/queries")
  let loadStoreContext: typeof import("@/lib/store-context").loadStoreContext

  beforeAll(async () => {
    lifecycle = await import("@/app/actions/store-lifecycle")
    ;({ createStore } = await import("@/app/actions/onboarding"))
    ;({ claimTrial } = await import("@/app/actions/billing"))
    ;({ closeCashierDay } = await import("@/app/actions/closing"))
    ;({ switchActiveStore } = await import("@/app/actions/store-members"))
    queries = await import("@/lib/queries")
    ;({ loadStoreContext } = await import("@/lib/store-context"))
  })

  beforeEach(async () => {
    await resetDb()
    // เจ้าของร้านทดสอบหลัก (ร้านอื่นที่ต้องไม่โดนลูกหลง)
    await ensureTestUser()
    await ensureTestUser("owner-z", "เจ้าของร้านใหม่", { storeId: null })
    setTestUser("owner-z")
    setActiveTestStore(null)
  })

  afterAll(async () => {
    setTestUser("test-user")
    setActiveTestStore(null)
    await disconnectTestDb()
  })

  /// ร้านใหม่จาก onboarding จริง (โต๊ะ/QR/เมนู/บทบาท/ร้านนวด) — ชื่อร้าน = "ร้านทดลองลบ"
  async function newStore(slug = "delete-me", opts: { spa?: boolean } = {}) {
    const result = await createStore(
      makeFormData({ name: "ร้านทดลองลบ", slug, themeColor: "#E8571F", ...(opts.spa ? { spa: "on" } : {}) }),
    )
    if (!result.ok || !result.data) throw new Error(`สร้างร้านไม่สำเร็จ: ${JSON.stringify(result)}`)
    setActiveTestStore(result.data.storeId)
    return result.data.storeId
  }

  let billSeq = 0
  async function bill(storeId: string) {
    billSeq += 1
    return testPrisma().sale.create({
      data: {
        storeId,
        saleNumber: `INV-L${String(billSeq).padStart(5, "0")}`,
        channel: "MOBILE_ORDER",
        subtotal: "10.00",
        total: "10.00",
        paymentMethod: "CASH",
        amountReceived: "10.00",
        cashierId: "owner-z",
        items: { create: [{ kind: "FOOD", name: "ทดสอบ", quantity: 1, unitPrice: "10.00", subtotal: "10.00" }] },
      },
    })
  }

  const form = (storeId: string, extra: Record<string, string> = {}) =>
    makeFormData({ storeId, confirmName: "ร้านทดลองลบ", ...extra })

  it("ลบร้านที่ไม่เคยใช้งานได้ครบทุกตาราง (รวมสิทธิ์ทดลอง · รอบปิดยอดว่าง · โต๊ะที่รวมกัน · ร้านนวด) — ร้านอื่นไม่โดน และสิทธิ์ทดลองยังถูกจำไว้", async () => {
    const storeId = await newStore("delete-me", { spa: true })
    const db = testPrisma()
    expect((await claimTrial(makeFormData({ promptPayId: "0891112222" }))).ok).toBe(true)
    expect((await closeCashierDay(makeFormData({ countedCash: "0" }))).ok).toBe(true)
    const [t1, t2] = await db.table.findMany({ where: { storeId }, orderBy: { code: "asc" } })
    await db.table.update({ where: { id: t2!.id }, data: { primaryTableId: t1!.id } })
    await db.tableSession.create({ data: { storeId, tableId: t1!.id } })
    await db.storeInvite.create({
      data: { storeId, email: "x@example.com", role: "STAFF", tokenHash: "hash-delete-me", invitedById: "owner-z", expiresAt: new Date(Date.now() + 86_400_000) },
    })
    const beforeA = await db.table.count({ where: { storeId: TEST_STORE_ID } })

    const result = await lifecycle.deleteStore(form(storeId))
    expect(result.ok, JSON.stringify(result)).toBe(true)

    expect(await db.store.findUnique({ where: { id: storeId } })).toBeNull()
    for (const count of await Promise.all([
      db.table.count({ where: { storeId } }),
      db.qRCode.count({ where: { storeId } }),
      db.menuItem.count({ where: { storeId } }),
      db.role.count({ where: { storeId } }),
      db.storeMember.count({ where: { storeId } }),
      db.storeSettings.count({ where: { storeId } }),
      db.storeSubscription.count({ where: { storeId } }),
      db.cashierClosing.count({ where: { storeId } }),
      db.therapist.count({ where: { storeId } }),
      db.kitchenStation.count({ where: { storeId } }),
      db.storeInvite.count({ where: { storeId } }),
    ])) {
      expect(count).toBe(0)
    }
    // สิทธิ์ทดลองยังถูกจำไว้ — ร้านใหม่เอาเลขเดิมไปรับซ้ำไม่ได้
    expect(await db.trialClaim.count({ where: { storeId } })).toBe(1)
    await newStore("delete-me-2")
    expect((await claimTrial(makeFormData({ promptPayId: "0891112222" }))).ok).toBe(false)
    // ร้านอื่นไม่โดนลูกหลง
    expect(await db.store.count({ where: { id: TEST_STORE_ID } })).toBe(1)
    expect(await db.table.count({ where: { storeId: TEST_STORE_ID } })).toBe(beforeA)
  })

  it("ร้านที่มีบิลแล้วลบไม่ได้ (บอกว่ามีอะไร) — ปิดร้านได้แทน · ร้านที่จ่ายค่าใช้งานแล้วก็ลบไม่ได้", async () => {
    const storeId = await newStore()
    await bill(storeId)
    const refused = await lifecycle.deleteStore(form(storeId))
    expect(refused.ok === false && refused.error).toContain("บิลขาย 1")
    expect(await testPrisma().store.count({ where: { id: storeId } })).toBe(1)

    const paidStore = await newStore("paid-store")
    await testPrisma().storeSubscription.create({
      data: {
        storeId: paidStore,
        kind: "RENEWAL",
        tier: "S",
        tableLimit: 12,
        days: 7,
        ratePerDay: "10.00",
        listPrice: "70.00",
        amount: "70.00",
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 7 * 86_400_000),
        paymentMethod: "PROMPTPAY",
        requestRef: "SUB-DELTEST1",
      },
    })
    const paid = await lifecycle.deleteStore(form(paidStore))
    expect(paid.ok === false && paid.error).toContain("การชำระค่าใช้งาน 1")
  })

  it("ต้องพิมพ์ชื่อร้านให้ตรง · ปิดร้านต้องมีเหตุผล · ร้านที่ถูกระงับปิด/ลบเองไม่ได้", async () => {
    const storeId = await newStore()
    expect((await lifecycle.deleteStore(form(storeId, { confirmName: "ร้านอื่น" }))).ok).toBe(false)
    const noReason = await lifecycle.closeStore(form(storeId, { reason: "ปิด" }))
    expect(noReason.ok === false && noReason.error).toContain("อย่างน้อย 5 ตัวอักษร")
    expect((await testPrisma().store.findUniqueOrThrow({ where: { id: storeId } })).status).toBe("ACTIVE")

    await testPrisma().store.update({ where: { id: storeId }, data: { status: "SUSPENDED" } })
    const closeSuspended = await lifecycle.closeStore(form(storeId, { reason: "ปิดกิจการแล้ว" }))
    expect(closeSuspended.ok === false && closeSuspended.error).toContain("ระงับ")
    expect((await lifecycle.deleteStore(form(storeId))).ok).toBe(false)
    expect(await testPrisma().store.count({ where: { id: storeId } })).toBe(1)
  })

  it("พนักงานในร้าน และเจ้าของร้านอื่น ปิด/ลบร้านนี้ไม่ได้", async () => {
    const storeId = await newStore()
    await ensureTestUser("staff-z", "พนักงาน", { storeId: null })
    await addTestMember("staff-z", storeId, "STAFF")

    setTestUser("staff-z")
    expect((await lifecycle.deleteStore(form(storeId))).ok).toBe(false)
    expect((await lifecycle.closeStore(form(storeId, { reason: "พนักงานลองปิด" }))).ok).toBe(false)

    // เจ้าของร้านทดสอบหลัก ไม่ได้อยู่ในร้านนี้เลย
    setTestUser("test-user")
    const outsider = await lifecycle.deleteStore(form(storeId))
    expect(outsider.ok === false && outsider.error).toContain("ไม่พบร้านนี้")

    expect((await testPrisma().store.findUniqueOrThrow({ where: { id: storeId } })).status).toBe("ACTIVE")
  })

  it("ปิดร้าน → พนักงานมองไม่เห็นร้าน · ลูกค้าสแกนไม่ได้ · สลับไปไม่ได้ · เจ้าของเห็นในรายการร้านที่ปิด → เปิดอีกครั้งกลับมาใช้ได้", async () => {
    const storeId = await newStore()
    await bill(storeId)
    await ensureTestUser("staff-z", "พนักงาน", { storeId: null })
    await addTestMember("staff-z", storeId, "STAFF")
    const qr = await testPrisma().qRCode.findFirstOrThrow({ where: { storeId } })

    // มีบิลค้างอยู่ปิดไม่ได้
    const table = await testPrisma().table.findFirstOrThrow({ where: { storeId } })
    const session = await testPrisma().tableSession.create({ data: { storeId, tableId: table.id } })
    const blocked = await lifecycle.closeStore(form(storeId, { reason: "ปิดกิจการแล้ว" }))
    expect(blocked.ok === false && blocked.error).toContain("เปิดบิลอยู่ 1")
    await testPrisma().tableSession.update({ where: { id: session.id }, data: { status: "CANCELLED" } })

    const closed = await lifecycle.closeStore(form(storeId, { reason: "ปิดกิจการแล้ว" }))
    expect(closed.ok, JSON.stringify(closed)).toBe(true)
    const row = await testPrisma().store.findUniqueOrThrow({ where: { id: storeId } })
    expect(row).toMatchObject({ status: "CLOSED", closedById: "owner-z", closeReason: "ปิดกิจการแล้ว" })
    expect(row.closedAt).not.toBeNull()

    const staff = await loadStoreContext(testPrisma(), "staff-z", storeId)
    expect(staff.ok).toBe(false)
    expect(staff.ok ? [] : staff.memberships).toEqual([])

    const owner = await loadStoreContext(testPrisma(), "owner-z", storeId)
    expect(owner.ok === false && owner.reason).toBe("NO_STORE")
    expect(owner.ok ? null : owner.memberships.find((m) => m.storeId === storeId)?.status).toBe("CLOSED")

    expect((await queries.resolveCustomerSession(qr.token)).ok).toBe(false)
    expect((await switchActiveStore(makeFormData({ storeId }))).ok).toBe(false)

    const reopened = await lifecycle.reopenStore(makeFormData({ storeId }))
    expect(reopened.ok, JSON.stringify(reopened)).toBe(true)
    expect(await testPrisma().store.findUniqueOrThrow({ where: { id: storeId } })).toMatchObject({
      status: "ACTIVE",
      closedAt: null,
      closedById: null,
      closeReason: null,
    })
    expect((await loadStoreContext(testPrisma(), "staff-z", storeId)).ok).toBe(true)
    expect((await lifecycle.reopenStore(makeFormData({ storeId }))).ok).toBe(false)
  })

  it("เจ้าของที่มีหลายร้าน ปิดร้านหนึ่งแล้วระบบพาไปร้านที่ยังเปิดอยู่ ไม่ค้างที่ร้านที่ปิด", async () => {
    const first = await newStore("first-store")
    const second = await newStore("second-store")
    await lifecycle.closeStore(form(first, { reason: "รวมไปร้านเดียว" }))
    const ctx = await loadStoreContext(testPrisma(), "owner-z", first)
    expect(ctx.ok && ctx.context.storeId).toBe(second)
  })

  it("★ ขายพร้อมกับกดลบร้าน → ได้อย่างใดอย่างหนึ่งเสมอ ไม่มีบิลค้างในร้านที่หายไป", async () => {
    for (let round = 0; round < 3; round++) {
      const storeId = await newStore(`race-${round}`)
      const [deleted, sale] = await Promise.allSettled([lifecycle.deleteStore(form(storeId)), bill(storeId)])
      const storeLeft = await testPrisma().store.count({ where: { id: storeId } })
      const deleteOk = deleted.status === "fulfilled" && deleted.value.ok
      if (deleteOk) {
        expect(sale.status).toBe("rejected")
        expect(storeLeft).toBe(0)
      } else {
        expect(sale.status).toBe("fulfilled")
        expect(storeLeft).toBe(1)
        expect(await testPrisma().sale.count({ where: { storeId } })).toBe(1)
      }
    }
  })
})
