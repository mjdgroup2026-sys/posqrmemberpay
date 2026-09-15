import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { DAY_MS } from "@/lib/subscription"
import {
  createTestProduct,
  createTestQrCode,
  createTestSession,
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
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()
const days = (n: number, from = Date.now()) => new Date(from + n * DAY_MS)
/// เทียบวันแบบยอมคลาดเคลื่อนไม่กี่วินาที (เวลารันเทส)
const closeTo = (actual: Date | null, expected: Date) => {
  expect(actual).not.toBeNull()
  if (actual) expect(Math.abs(actual.getTime() - expected.getTime())).toBeLessThan(10_000)
}

/// ค่าใช้งานแบบต่ออายุ (Phase 14b) — แตะเงิน: ทุกกติกาใน spec ต้องมีเทส รวม concurrent
describe.skipIf(!dbReady)("ค่าใช้งานแบบต่ออายุ — billing / admin-billing (Phase 14b)", () => {
  let billing: typeof import("@/app/actions/billing")
  let admin: typeof import("@/app/actions/admin-billing")
  let tables: typeof import("@/app/actions/tables")
  let sales: typeof import("@/app/actions/sales")
  let customer: typeof import("@/app/actions/customer-order")
  let queries: typeof import("@/lib/queries")
  let planQueries: typeof import("@/lib/plan-queries")

  beforeAll(async () => {
    billing = await import("@/app/actions/billing")
    admin = await import("@/app/actions/admin-billing")
    tables = await import("@/app/actions/tables")
    sales = await import("@/app/actions/sales")
    customer = await import("@/app/actions/customer-order")
    queries = await import("@/lib/queries")
    planQueries = await import("@/lib/plan-queries")
  })

  beforeEach(async () => {
    await resetDb()
    // แพ็กเกจมาตรฐานถูก seed โดย migration และไม่ถูก TRUNCATE — ยืนยันว่ามีให้ใช้
    expect(await testPrisma().subscriptionPlan.count({ where: { isActive: true } })).toBeGreaterThanOrEqual(25)
    // ร้านใหม่ที่ยังไม่มีแพ็กเกจ (เหมือนสร้างจาก /onboarding)
    await ensureTestStore({ plan: "none" })
    await ensureTestUser("owner", "เจ้าของร้าน", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestUser("staff", "พนักงาน", { storeId: TEST_STORE_ID, role: "STAFF" })
    await ensureTestUser("platform", "ทีมแพลตฟอร์ม", { storeId: null, isPlatformAdmin: true })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  const store = () => testPrisma().store.findUniqueOrThrow({ where: { id: TEST_STORE_ID } })
  async function setPlan(tier: "S" | "M" | "L" | "XL", tableLimit: number, expiresAt: Date | null) {
    await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { planTier: tier, tableLimit, planExpiresAt: expiresAt } })
  }
  /// สร้างแถว PAID ตรง ๆ ให้ ledger สอดคล้องกับ setPlan (ไว้ทดสอบ void ถอยกลับ)
  async function seedPaidRenewal(tier: "S" | "M", days: number, start: Date, end: Date, ref: string) {
    return testPrisma().storeSubscription.create({
      data: {
        storeId: TEST_STORE_ID,
        kind: "RENEWAL",
        tier,
        tableLimit: tier === "S" ? 12 : 30,
        days,
        ratePerDay: tier === "S" ? "10.00" : "20.00",
        listPrice: "300.00",
        amount: "280.00",
        periodStart: start,
        periodEnd: end,
        status: "PAID",
        paymentMethod: "PROMPTPAY",
        requestRef: ref,
        paymentReference: `BANK-${ref}`,
        paidAt: start,
      },
    })
  }

  // ───────────── ทดลองใช้ ─────────────

  describe("claimTrial — ทดลอง 7 วัน ครั้งเดียวต่อเลขพร้อมเพย์", () => {
    it("ร้านใหม่กรอกพร้อมเพย์ → TRIAL PAID · store S/12/+7 วัน · promptPayId ถูก normalize · TrialClaim เก็บ hash", async () => {
      const result = await billing.claimTrial(makeFormData({ promptPayId: "081-234-5678" }))
      expect(result.ok, JSON.stringify(result)).toBe(true)

      const s = await store()
      expect(s.planTier).toBe("S")
      expect(s.tableLimit).toBe(12)
      closeTo(s.planExpiresAt, days(7))

      const row = await testPrisma().storeSubscription.findFirstOrThrow({ where: { storeId: TEST_STORE_ID } })
      expect(row).toMatchObject({ kind: "TRIAL", status: "PAID", paymentMethod: "FREE", tier: "S", days: 7 })
      expect(Number(row.amount)).toBe(0)

      const settings = await testPrisma().storeSettings.findUniqueOrThrow({ where: { storeId: TEST_STORE_ID } })
      expect(settings.promptPayId).toBe("0812345678")

      const claims = await testPrisma().trialClaim.findMany()
      expect(claims).toHaveLength(1)
      expect(claims[0].promptPayIdHash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(claims)).not.toContain("0812345678")
    })

    it("STAFF รับไม่ได้ · รูปแบบเลขผิด → ok:false ไม่มีแถว", async () => {
      setTestUser("staff")
      expect((await billing.claimTrial(makeFormData({ promptPayId: "0812345678" }))).ok).toBe(false)
      setTestUser("owner")
      const bad = await billing.claimTrial(makeFormData({ promptPayId: "12345" }))
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.fieldErrors?.promptPayId).toBeTruthy()
      expect(await testPrisma().trialClaim.count()).toBe(0)
      expect((await store()).planExpiresAt).toBeNull()
    })

    it("เลขเดิมเขียนต่างรูปแบบจากร้านที่ 2 → ไม่ได้ทดลอง และร้าน 2 ยังไม่มีแพ็กเกจ · ลบร้าน 2 แล้วสมัครใหม่ด้วยเลขเดิม → ยังไม่ได้", async () => {
      expect((await billing.claimTrial(makeFormData({ promptPayId: "0812345678" }))).ok).toBe(true)

      await ensureTestStore({ id: OTHER_STORE_ID, plan: "none" })
      await ensureTestUser("owner-b", "เจ้าของ B", { storeId: OTHER_STORE_ID, role: "OWNER" })
      setTestUser("owner-b")
      setActiveTestStore(OTHER_STORE_ID)
      const denied = await billing.claimTrial(makeFormData({ promptPayId: "+66812345678" }))
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error).toContain("เคยใช้สิทธิ์ทดลอง")
      expect((await testPrisma().store.findUniqueOrThrow({ where: { id: OTHER_STORE_ID } })).planExpiresAt).toBeNull()

      // ลบร้าน B ทั้งร้าน (TrialClaim ไม่มี FK จึงยังอยู่) → สร้างใหม่ด้วย id เดิม → เลขเดิมยังใช้ไม่ได้
      await testPrisma().store.delete({ where: { id: OTHER_STORE_ID } })
      expect(await testPrisma().trialClaim.count()).toBe(1)
      await ensureTestStore({ id: OTHER_STORE_ID, plan: "none" })
      await ensureTestUser("owner-b", "เจ้าของ B", { storeId: OTHER_STORE_ID, role: "OWNER" })
      expect((await billing.claimTrial(makeFormData({ promptPayId: "081 234 5678" }))).ok).toBe(false)
    })

    it("ร้านเดียวกดซ้ำ / ร้านที่มีแพ็กเกจแล้ว → ok:false", async () => {
      expect((await billing.claimTrial(makeFormData({ promptPayId: "0812345678" }))).ok).toBe(true)
      expect((await billing.claimTrial(makeFormData({ promptPayId: "0899999999" }))).ok).toBe(false)
      expect(await testPrisma().trialClaim.count()).toBe(1)
    })

    it("★ สองร้านกดรับพร้อมกันด้วยเลขเดียว → สำเร็จร้านเดียว", async () => {
      await ensureTestStore({ id: OTHER_STORE_ID, plan: "none" })
      await ensureTestUser("owner-b", "เจ้าของ B", { storeId: OTHER_STORE_ID, role: "OWNER" })
      // mock session อ่านจากตัวแปร module เดียว — ยิงร้าน A ก่อนแล้วสลับเป็น B ทันทีโดยไม่ await ตัวแรก
      const first = billing.claimTrial(makeFormData({ promptPayId: "0812345678" }))
      setTestUser("owner-b")
      setActiveTestStore(OTHER_STORE_ID)
      const second = billing.claimTrial(makeFormData({ promptPayId: "081-234-5678" }))
      const results = await Promise.all([first, second])
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect(await testPrisma().trialClaim.count()).toBe(1)
      expect(await testPrisma().storeSubscription.count({ where: { kind: "TRIAL" } })).toBe(1)
    })
  })

  // ───────────── หมดอายุ = อ่านได้ ขายไม่ได้ ─────────────

  describe("ร้านหมดอายุ / ยังไม่มีแพ็กเกจ", () => {
    it("ยังไม่มีแพ็กเกจ: เปิดโต๊ะ (พนักงาน) / ขาย POS / ลูกค้าสั่ง → ok:false ข้อความไทย · แต่รายงานยังอ่านได้", async () => {
      const table = await createTestTable("T1")
      const qr = await createTestQrCode(table.id)
      const product = await createTestProduct({ quantity: 5 })

      const open = await tables.openTableSession(makeFormData({ tableId: table.id }))
      expect(open.ok).toBe(false)
      if (!open.ok) expect(open.error).toMatch(/หมดอายุ|ยังไม่ได้เปิดใช้งาน/)

      const sale = await sales.createSale(
        makeFormData({ items: JSON.stringify([{ productId: product.id, quantity: 1 }]), discount: "0", paymentMethod: "CASH", amountReceived: "100", note: "" }),
      )
      expect(sale.ok).toBe(false)
      expect((await testPrisma().product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(5)

      const byQr = await tables.openTableSession(makeFormData({ qrToken: qr.token }))
      expect(byQr.ok).toBe(false)
      if (!byQr.ok) expect(byQr.error).toContain("ปิดรับออเดอร์ชั่วคราว")

      // อ่านได้
      await expect(queries.getDashboardStats(TEST_STORE_ID)).resolves.toBeTruthy()
      await expect(queries.listSales(TEST_STORE_ID)).resolves.toEqual([])
      expect(await queries.resolveCustomerSession(qr.token)).toEqual({ ok: false, reason: "STORE_EXPIRED" })
    })

    it("หมดอายุระหว่างที่โต๊ะเปิดอยู่: สั่งเพิ่มไม่ได้ แต่เช็กบิล (requestBill) ยังได้", async () => {
      await setPlan("S", 12, days(-1))
      const table = await createTestTable("T1")
      const qr = await createTestQrCode(table.id)
      await createTestSession(table.id, { qrCodeId: qr.id })
      const menu = await testPrisma().menuItem.create({ data: { storeId: TEST_STORE_ID, name: "เมนู", price: "50.00" } })

      const order = await customer.submitOrder(
        makeFormData({ qrToken: qr.token, items: JSON.stringify([{ menuItemId: menu.id, quantity: 1, optionIds: [] }]) }),
      )
      expect(order.ok).toBe(false)
      if (!order.ok) expect(order.error).toContain("ปิดรับออเดอร์ชั่วคราว")

      const bill = await customer.requestBill(makeFormData({ qrToken: qr.token }))
      expect(bill.ok, JSON.stringify(bill)).toBe(true)
      // มี session อยู่ → resolveCustomerSession ยังคืน ok ให้หน้าเช็กบิล/จ่ายทำงานต่อ
      expect((await queries.resolveCustomerSession(qr.token)).ok).toBe(true)
    })

    it("มีแพ็กเกจที่ยังไม่หมด → เปิดโต๊ะได้ตามปกติ", async () => {
      await setPlan("S", 12, days(3))
      const table = await createTestTable("T1")
      expect((await tables.openTableSession(makeFormData({ tableId: table.id }))).ok).toBe(true)
    })
  })

  // ───────────── ต่ออายุ + ยืนยัน ─────────────

  describe("requestRenewal → confirmSubscription", () => {
    it("ขอ S-D30 → PENDING พร้อม SUB-ref · ขอซ้ำระหว่างรอ → ok:false · ยกเลิกแล้วขอใหม่ได้", async () => {
      const r1 = await billing.requestRenewal(makeFormData({ planCode: "S-D30" }))
      expect(r1.ok, JSON.stringify(r1)).toBe(true)
      if (r1.ok) {
        expect(r1.data?.requestRef).toMatch(/^SUB-[23456789A-HJ-NP-Z]{6}$/)
        expect(r1.data?.amount).toBe(280)
      }
      const row = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      expect(row).toMatchObject({ kind: "RENEWAL", tier: "S", tableLimit: 12, days: 30 })
      expect(Number(row.amount)).toBe(280)
      expect(Number(row.listPrice)).toBe(300)
      // ยังไม่มีผลกับร้าน
      expect((await store()).planExpiresAt).toBeNull()

      expect((await billing.requestRenewal(makeFormData({ planCode: "M-D7" }))).ok).toBe(false)
      expect((await billing.cancelPendingRequest(makeFormData({ id: row.id }))).ok).toBe(true)
      expect((await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("VOID")
      expect((await billing.requestRenewal(makeFormData({ planCode: "M-D7" }))).ok).toBe(true)
    })

    it("STAFF ขอไม่ได้ · รหัสแพ็กเกจไม่มี/TRIAL → ok:false", async () => {
      setTestUser("staff")
      expect((await billing.requestRenewal(makeFormData({ planCode: "S-D30" }))).ok).toBe(false)
      setTestUser("owner")
      expect((await billing.requestRenewal(makeFormData({ planCode: "Z-D99" }))).ok).toBe(false)
      expect((await billing.requestRenewal(makeFormData({ planCode: "TRIAL" }))).ok).toBe(false)
      expect(await testPrisma().storeSubscription.count()).toBe(0)
    })

    it("★ stack: เหลือ 10 วัน ยืนยัน S-D30 → หมดอายุ +40 วัน ไม่ใช่ +30 · tier/เพดานตามแพ็กเกจ · expiryNoticeLevel รีเซ็ต", async () => {
      await setPlan("S", 12, days(10))
      await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { expiryNoticeLevel: 7 } })
      const r = await billing.requestRenewal(makeFormData({ planCode: "S-D30" }))
      expect(r.ok).toBe(true)
      const row = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })

      setTestUser("platform")
      const confirmed = await admin.confirmSubscription(makeFormData({ id: row.id, paymentReference: "SCB-0001" }))
      expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true)

      const s = await store()
      closeTo(s.planExpiresAt, days(40))
      expect(s.planTier).toBe("S")
      expect(s.tableLimit).toBe(12)
      expect(s.expiryNoticeLevel).toBe(0)

      const paid = await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: row.id } })
      expect(paid.status).toBe("PAID")
      expect(paid.paymentReference).toBe("SCB-0001")
      expect(paid.confirmedById).toBe("platform")
      closeTo(paid.periodStart, days(10))
      closeTo(paid.periodEnd, days(40))
    })

    it("หมดอายุแล้ว 5 วัน ยืนยัน 30 วัน → นับจากวันนี้ (+30) ไม่ย้อนหลัง", async () => {
      await setPlan("S", 12, days(-5))
      await billing.requestRenewal(makeFormData({ planCode: "S-D30" }))
      const row = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      setTestUser("platform")
      expect((await admin.confirmSubscription(makeFormData({ id: row.id, paymentReference: "SCB-0002" }))).ok).toBe(true)
      closeTo((await store()).planExpiresAt, days(30))
    })

    it("★ ยืนยันพร้อมกัน 2 คำขอกับแถว PENDING เดียว → ผ่านแค่ 1 และวันไม่ถูกเพิ่มซ้ำ", async () => {
      await setPlan("S", 12, days(10))
      await billing.requestRenewal(makeFormData({ planCode: "S-D30" }))
      const row = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      setTestUser("platform")

      const results = await Promise.all([
        admin.confirmSubscription(makeFormData({ id: row.id, paymentReference: "SCB-A" })),
        admin.confirmSubscription(makeFormData({ id: row.id, paymentReference: "SCB-B" })),
      ])
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      closeTo((await store()).planExpiresAt, days(40))
    })

    it("ยืนยันซ้ำด้วยเลขอ้างอิงธนาคารเดิม (unique) → ok:false ไม่เพิ่มวัน", async () => {
      await setPlan("S", 12, days(10))
      await billing.requestRenewal(makeFormData({ planCode: "S-D7" }))
      const first = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      setTestUser("platform")
      expect((await admin.confirmSubscription(makeFormData({ id: first.id, paymentReference: "SAME-REF" }))).ok).toBe(true)

      setTestUser("owner")
      await billing.requestRenewal(makeFormData({ planCode: "S-D7" }))
      const second = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      setTestUser("platform")
      const dup = await admin.confirmSubscription(makeFormData({ id: second.id, paymentReference: "SAME-REF" }))
      expect(dup.ok).toBe(false)
      if (!dup.ok) expect(dup.error).toContain("ถูกใช้")
      expect((await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PENDING")
      closeTo((await store()).planExpiresAt, days(17))
    })

    it("ผู้ที่ไม่ใช่ admin ยืนยัน/ยกเลิก/เติมวัน/ตั้งเพดาน/ออกแพ็กเกจ → ok:false ทุกตัว", async () => {
      await billing.requestRenewal(makeFormData({ planCode: "S-D7" }))
      const row = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      expect((await admin.confirmSubscription(makeFormData({ id: row.id, paymentReference: "X" }))).ok).toBe(false)
      expect((await admin.voidSubscription(makeFormData({ id: row.id, reason: "ทดสอบ" }))).ok).toBe(false)
      expect((await admin.grantCustomDays(makeFormData({ storeId: TEST_STORE_ID, days: 5, note: "ทดสอบ" }))).ok).toBe(false)
      expect((await admin.setTableLimit(makeFormData({ storeId: TEST_STORE_ID, tableLimit: 50, note: "ทดสอบ" }))).ok).toBe(false)
      expect(
        (await admin.publishPlanVersion(makeFormData({ code: "S-D7", name: "x", tier: "S", tableLimit: 12, durationDays: 7, ratePerDay: 10, price: 60 }))).ok,
      ).toBe(false)
      expect((await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING")
    })
  })

  // ───────────── ดาวน์เกรด / อัปเกรด ─────────────

  describe("เปลี่ยน tier", () => {
    it("ดาวน์เกรด M→S ตอนมี 20 โต๊ะ → ปฏิเสธพร้อมบอกว่าต้องลบ 8 โต๊ะ", async () => {
      await setPlan("M", 30, days(20))
      for (let i = 1; i <= 20; i += 1) await createTestTable(`T${i}`)
      const r = await billing.requestRenewal(makeFormData({ planCode: "S-D30" }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain("ลบ 8 โต๊ะ")
    })

    it("★ อัปเกรด S→M เหลือ 20 วัน → ส่วนต่าง 200 บาท · ยืนยันแล้ว tableLimit 30 ทันที · planExpiresAt ไม่เปลี่ยน", async () => {
      const expiresAt = days(20)
      await setPlan("S", 12, expiresAt)
      const r = await billing.requestUpgrade(makeFormData({ tier: "M" }))
      expect(r.ok, JSON.stringify(r)).toBe(true)
      if (r.ok) expect(r.data?.amount).toBe(200)

      const row = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      expect(row).toMatchObject({ kind: "UPGRADE", tier: "M", tableLimit: 30, days: 20 })
      expect(Number(row.amount)).toBe(200)

      setTestUser("platform")
      expect((await admin.confirmSubscription(makeFormData({ id: row.id, paymentReference: "UPG-1" }))).ok).toBe(true)
      const s = await store()
      expect(s.planTier).toBe("M")
      expect(s.tableLimit).toBe(30)
      expect(s.planExpiresAt?.getTime()).toBe(expiresAt.getTime())
      const paid = await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: row.id } })
      expect(paid.periodEnd.getTime()).toBe(expiresAt.getTime())
    })

    it("อัปเกรดลง/เท่าเดิม/ไม่มีแพ็กเกจ → ok:false", async () => {
      expect((await billing.requestUpgrade(makeFormData({ tier: "M" }))).ok).toBe(false)
      await setPlan("M", 30, days(20))
      expect((await billing.requestUpgrade(makeFormData({ tier: "S" }))).ok).toBe(false)
      expect((await billing.requestUpgrade(makeFormData({ tier: "M" }))).ok).toBe(false)
      expect((await billing.requestUpgrade(makeFormData({ tier: "L" }))).ok).toBe(true)
    })
  })

  // ───────────── void ถอยกลับ ─────────────

  describe("voidSubscription", () => {
    it("void แถว PAID (RENEWAL 30 วัน) → planExpiresAt ถอย 30 วัน · แถวเดิมยัง PAID · มีแถว VOID ชดเชยชี้ reversesId · tier จากแถวที่เหลือ", async () => {
      const t0 = new Date()
      await seedPaidRenewal("S", 30, days(-20, t0.getTime()), days(10, t0.getTime()), "SUB-AAAAAA")
      const m = await seedPaidRenewal("M", 30, days(10, t0.getTime()), days(40, t0.getTime()), "SUB-BBBBBB")
      await setPlan("M", 30, days(40, t0.getTime()))

      setTestUser("platform")
      const r = await admin.voidSubscription(makeFormData({ id: m.id, reason: "โอนผิดยอด คืนเงินแล้ว" }))
      expect(r.ok, JSON.stringify(r)).toBe(true)

      const s = await store()
      closeTo(s.planExpiresAt, days(10, t0.getTime()))
      expect(s.planTier).toBe("S")
      expect(s.tableLimit).toBe(12)

      const original = await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: m.id }, include: { reversal: true } })
      expect(original.status).toBe("PAID")
      expect(original.reversal?.status).toBe("VOID")
      expect(Number(original.reversal?.amount)).toBe(-280)
      expect(original.reversal?.reversesId).toBe(m.id)

      // void ซ้ำแถวเดิม → ok:false
      expect((await admin.voidSubscription(makeFormData({ id: m.id, reason: "ซ้ำ" }))).ok).toBe(false)
    })

    it("void แถว PAID ใบเดียวที่มี → ร้านกลับเป็นไม่มีแพ็กเกจ (null) · void PENDING → VOID ตรง ๆ", async () => {
      expect((await billing.claimTrial(makeFormData({ promptPayId: "0812345678" }))).ok).toBe(true)
      const trial = await testPrisma().storeSubscription.findFirstOrThrow({ where: { kind: "TRIAL" } })
      setTestUser("platform")
      expect((await admin.voidSubscription(makeFormData({ id: trial.id, reason: "ทดสอบ" }))).ok).toBe(true)
      expect((await store()).planExpiresAt).toBeNull()

      setTestUser("owner")
      await billing.requestRenewal(makeFormData({ planCode: "S-D7" }))
      const pending = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      setTestUser("platform")
      expect((await admin.voidSubscription(makeFormData({ id: pending.id, reason: "ร้านขอยกเลิก" }))).ok).toBe(true)
      expect((await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("VOID")
    })
  })

  // ───────────── CUSTOM ─────────────

  describe("grantCustomDays / setTableLimit", () => {
    it("เติม 10 วัน → stack ต่อท้าย เป็นแถว CUSTOM/FREE · เพดานพิเศษ 200 → store.tableLimit 200 และ ledger มีแถว", async () => {
      await setPlan("S", 12, days(5))
      setTestUser("platform")
      expect((await admin.grantCustomDays(makeFormData({ storeId: TEST_STORE_ID, days: 10, note: "ชดเชยระบบล่ม" }))).ok).toBe(true)
      closeTo((await store()).planExpiresAt, days(15))
      const custom = await testPrisma().storeSubscription.findFirstOrThrow({ where: { kind: "CUSTOM" } })
      expect(custom).toMatchObject({ status: "PAID", paymentMethod: "FREE", days: 10 })

      expect((await admin.setTableLimit(makeFormData({ storeId: TEST_STORE_ID, tableLimit: 200, note: "ดีลพิเศษ" }))).ok).toBe(true)
      expect((await store()).tableLimit).toBe(200)
      expect(await testPrisma().storeSubscription.count({ where: { kind: "CUSTOM" } })).toBe(2)

      // ตั้งต่ำกว่าโต๊ะที่มี → ok:false
      await createTestTable("A1")
      await createTestTable("A2")
      expect((await admin.setTableLimit(makeFormData({ storeId: TEST_STORE_ID, tableLimit: 1, note: "ต่ำเกิน" }))).ok).toBe(false)
    })
  })

  // ───────────── plan versions ─────────────

  describe("publishPlanVersion / retirePlan — ประวัติเรต append-only", () => {
    it("ออก version ใหม่ → แถวเก่า isActive=false + supersededById · แถว StoreSubscription ที่ซื้อไปแล้วตัวเลขไม่เปลี่ยน · listActivePlans เห็นแค่ตัวใหม่", async () => {
      // ซื้อ version 1 ก่อน
      await setPlan("S", 12, days(10))
      await billing.requestRenewal(makeFormData({ planCode: "S-D7" }))
      const bought = await testPrisma().storeSubscription.findFirstOrThrow({ where: { status: "PENDING" } })
      const v1 = await testPrisma().subscriptionPlan.findFirstOrThrow({ where: { code: "S-D7", isActive: true } })

      setTestUser("platform")
      const published = await admin.publishPlanVersion(
        makeFormData({ code: "S-D7", name: "S · 7 วัน (ราคาใหม่)", tier: "S", tableLimit: 12, durationDays: 7, ratePerDay: 12, price: 84 }),
      )
      expect(published.ok, JSON.stringify(published)).toBe(true)

      const old = await testPrisma().subscriptionPlan.findUniqueOrThrow({ where: { id: v1.id } })
      expect(old.isActive).toBe(false)
      expect(Number(old.price)).toBe(70)
      expect(old.supersededById).not.toBeNull()
      const v2 = await testPrisma().subscriptionPlan.findFirstOrThrow({ where: { code: "S-D7", isActive: true } })
      expect(v2.version).toBe(v1.version + 1)
      expect(Number(v2.price)).toBe(84)

      const boughtAfter = await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: bought.id } })
      expect(Number(boughtAfter.amount)).toBe(70)
      expect(boughtAfter.planId).toBe(v1.id)

      const active = await planQueries.listActivePlans()
      expect(active.filter((p) => p.code === "S-D7")).toHaveLength(1)
      expect(active.find((p) => p.code === "S-D7")?.price).toBe(84)

      // คืนสภาพให้เทสอื่น: ออก version 3 ราคาเดิม (append-only — ไม่แก้แถว)
      await admin.publishPlanVersion(makeFormData({ code: "S-D7", name: "S · 7 วัน", tier: "S", tableLimit: 12, durationDays: 7, ratePerDay: 10, price: 70 }))
    })

    it("retirePlan ปิดการขาย · TRIAL เลิกไม่ได้ · code ใหม่เริ่ม version 1", async () => {
      setTestUser("platform")
      const created = await admin.publishPlanVersion(
        makeFormData({ code: "TT-D1", name: "ทดสอบ 1 วัน", tier: "S", tableLimit: 12, durationDays: 1, ratePerDay: 10, price: 10 }),
      )
      expect(created.ok).toBe(true)
      if (created.ok) expect(created.data?.version).toBe(1)
      expect((await admin.retirePlan(makeFormData({ code: "TT-D1" }))).ok).toBe(true)
      expect(await testPrisma().subscriptionPlan.count({ where: { code: "TT-D1", isActive: true } })).toBe(0)
      expect((await admin.retirePlan(makeFormData({ code: "TT-D1" }))).ok).toBe(false)
      expect((await admin.retirePlan(makeFormData({ code: "TRIAL" }))).ok).toBe(false)
      await testPrisma().subscriptionPlan.deleteMany({ where: { code: "TT-D1" } })
    })
  })

  it("getBillingOverview / listSubscriptionHistory สรุปถูก", async () => {
    await createTestTable("T1")
    const overview0 = await queries.getBillingOverview(TEST_STORE_ID)
    expect(overview0).toMatchObject({ tier: null, tableLimit: 12, planExpiresAt: null, tableCount: 1, pending: null, trialAvailable: true, promptPayIdSet: false })

    await billing.claimTrial(makeFormData({ promptPayId: "0812345678" }))
    await billing.requestRenewal(makeFormData({ planCode: "S-D30" }))
    const overview = await queries.getBillingOverview(TEST_STORE_ID)
    expect(overview.tier).toBe("S")
    expect(overview.trialAvailable).toBe(false)
    expect(overview.promptPayIdSet).toBe(true)
    expect(overview.pending?.kind).toBe("RENEWAL")
    const history = await queries.listSubscriptionHistory(TEST_STORE_ID)
    expect(history.map((h) => h.kind)).toEqual(["RENEWAL", "TRIAL"])
  })
})
