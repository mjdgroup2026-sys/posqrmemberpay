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

describe.skipIf(!dbReady)("ตั้งค่าร้านและสมาชิก (Phase 12)", () => {
  let updateStoreSettings: (formData: FormData) => Promise<ActionResult>
  let setFeaturedMenu: (formData: FormData) => Promise<ActionResult>
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let confirmMobilePayment: (formData: FormData) => Promise<ActionResult<{ saleNumber: string }>>
  let registerMember: (formData: FormData) => Promise<ActionResult<{ pointBalance: number; earnedPoints: number }>>

  beforeAll(async () => {
    const settings = await import("@/app/actions/settings")
    const tables = await import("@/app/actions/tables")
    const payments = await import("@/app/actions/payments")
    const members = await import("@/app/actions/members")
    updateStoreSettings = settings.updateStoreSettings
    setFeaturedMenu = settings.setFeaturedMenu
    openTableSession = tables.openTableSession
    confirmMobilePayment = payments.confirmMobilePayment
    registerMember = members.registerMember
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
    await setStoreSettings({ hasKDS: false, serviceChargePercent: "0.00" })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  function settingsForm(overrides: Record<string, string> = {}) {
    return makeFormData({
      storeName: "ร้านทดสอบ",
      themeColor: "#E8571F",
      logoUrl: "",
      coverImageUrl: "",
      serviceChargePercent: "0",
      ...overrides,
    })
  }

  describe("F21 — ตั้งค่าแบรนด์/ธีม/เมนูแนะนำ", () => {
    it("บันทึกชื่อร้าน สีธีม และค่าบริการได้", async () => {
      const result = await updateStoreSettings(
        settingsForm({ storeName: "ครัวคุณแม่", themeColor: "#123ABC", serviceChargePercent: "7.5" }),
      )
      expect(result.ok).toBe(true)

      const saved = await testPrisma().storeSettings.findUnique({ where: { storeId: TEST_STORE_ID } })
      expect(saved?.storeName).toBe("ครัวคุณแม่")
      expect(saved?.themeColor).toBe("#123ABC")
      expect(Number(saved?.serviceChargePercent)).toBe(7.5)
    })

    it("ตั้งโหมดเริ่มต้นของจอขายอาหารเป็นกลับบ้านได้ · ค่าเริ่มต้นคือโต๊ะ · ค่าแปลกถูกปฏิเสธ", async () => {
      const db = testPrisma()
      expect((await db.storeSettings.findUnique({ where: { storeId: TEST_STORE_ID } }))?.posDefaultMode).toBe("TABLE")

      const ok = await updateStoreSettings(settingsForm({ posDefaultMode: "TAKEAWAY" }))
      expect(ok.ok).toBe(true)
      expect((await db.storeSettings.findUnique({ where: { storeId: TEST_STORE_ID } }))?.posDefaultMode).toBe("TAKEAWAY")

      const bad = await updateStoreSettings(settingsForm({ posDefaultMode: "DELIVERY" }))
      expect(bad.ok).toBe(false)
      expect((await db.storeSettings.findUnique({ where: { storeId: TEST_STORE_ID } }))?.posDefaultMode).toBe("TAKEAWAY")
    })

    it("พักระหว่างคิวนวด: ตั้ง 0–120 ได้ · ไม่ส่งช่องมา = ค่าเดิมไม่ถูกแตะ · นอกช่วง/ทศนิยมถูกปฏิเสธ", async () => {
      const db = testPrisma()
      const buffer = async () => (await db.storeSettings.findUnique({ where: { storeId: TEST_STORE_ID } }))?.bookingBufferMinutes
      expect(await buffer()).toBe(10)

      expect((await updateStoreSettings(settingsForm({ bookingBufferMinutes: "0" }))).ok).toBe(true)
      expect(await buffer()).toBe(0)

      // ร้านที่ปิดตัวเลือกร้านนวดไม่มีช่องนี้ในฟอร์ม — บันทึกอย่างอื่นต้องไม่รีเซ็ตค่าที่ตั้งไว้
      expect((await updateStoreSettings(settingsForm({ storeName: "ร้านใหม่" }))).ok).toBe(true)
      expect(await buffer()).toBe(0)

      for (const bad of ["-5", "121", "7.5", "abc"]) {
        const result = await updateStoreSettings(settingsForm({ bookingBufferMinutes: bad }))
        expect(result.ok).toBe(false)
      }
      expect(await buffer()).toBe(0)
    })

    it("สีธีมที่ไม่ใช่ hex 6 หลักต้องถูกปฏิเสธ — ค่านี้ถูกยัดลง inline style ของหน้าลูกค้า", async () => {
      for (const bad of ["red", "#FFF", "#12345G", "javascript:alert(1)"]) {
        const result = await updateStoreSettings(settingsForm({ themeColor: bad }))
        expect(result.ok).toBe(false)
      }
    })

    it("ลิงก์รูปที่ไม่ใช่ http/https หรือ path ภายในต้องถูกปฏิเสธ", async () => {
      const bad = await updateStoreSettings(settingsForm({ logoUrl: "javascript:alert(1)" }))
      expect(bad.ok).toBe(false)

      const good = await updateStoreSettings(settingsForm({ logoUrl: "/logo.png" }))
      expect(good.ok).toBe(true)
      expect((await testPrisma().storeSettings.findUnique({ where: { storeId: TEST_STORE_ID } }))?.logoUrl).toBe("/logo.png")
    })

    it("สลับ hasKDS ขณะมีโต๊ะเปิดอยู่ต้องถูกปฏิเสธ", async () => {
      const table = await createTestTable()
      await openTableSession(makeFormData({ tableId: table.id }))

      const result = await updateStoreSettings(settingsForm({ hasKDS: "true" }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("ยังมีโต๊ะเปิดอยู่")

      // ค่าเดิมต้องไม่ถูกแตะเลย
      expect((await testPrisma().storeSettings.findUnique({ where: { storeId: TEST_STORE_ID } }))?.hasKDS).toBe(false)
    })

    it("สลับ hasKDS ได้เมื่อไม่มีโต๊ะเปิดอยู่ และแก้ค่าอื่นตอนมีโต๊ะเปิดยังทำได้", async () => {
      const ok = await updateStoreSettings(settingsForm({ hasKDS: "true" }))
      expect(ok.ok).toBe(true)
      expect((await testPrisma().storeSettings.findUnique({ where: { storeId: TEST_STORE_ID } }))?.hasKDS).toBe(true)

      const table = await createTestTable()
      await openTableSession(makeFormData({ tableId: table.id }))

      // ไม่ได้สลับ hasKDS จึงต้องผ่านแม้มีโต๊ะเปิดอยู่
      const rename = await updateStoreSettings(settingsForm({ storeName: "ชื่อใหม่", hasKDS: "true" }))
      expect(rename.ok).toBe(true)
    })

    it("ปักหมุดเมนูแนะนำได้ตามลำดับที่ส่งมา และรายการที่ 7 ถูกปฏิเสธที่ server", async () => {
      const db = testPrisma()
      const items = []
      for (let i = 1; i <= 7; i++) {
        items.push(await createTestMenuItem({ name: `เมนู ${i}` }))
      }

      const tooMany = await setFeaturedMenu(makeFormData({ menuItemIds: items.map((m) => m.id).join(",") }))
      expect(tooMany.ok).toBe(false)
      expect(await db.menuItem.count({ where: { isFeatured: true } })).toBe(0)

      const chosen = [items[2], items[0], items[1]].map((m) => m!.id)
      const ok = await setFeaturedMenu(makeFormData({ menuItemIds: chosen.join(",") }))
      expect(ok.ok).toBe(true)

      const featured = await db.menuItem.findMany({
        where: { isFeatured: true },
        orderBy: { featuredSortOrder: "asc" },
        select: { id: true, featuredSortOrder: true },
      })
      expect(featured.map((f) => f.id)).toEqual(chosen)
      expect(featured.map((f) => f.featuredSortOrder)).toEqual([0, 1, 2])
    })

    it("ถอดเมนูออกจากรายการแนะนำแล้ว หมุดเดิมต้องไม่ค้าง", async () => {
      const db = testPrisma()
      const a = await createTestMenuItem({ name: "เมนู ก" })
      const b = await createTestMenuItem({ name: "เมนู ข" })

      await setFeaturedMenu(makeFormData({ menuItemIds: `${a.id},${b.id}` }))
      await setFeaturedMenu(makeFormData({ menuItemIds: b.id }))

      const featured = await db.menuItem.findMany({ where: { isFeatured: true }, select: { id: true } })
      expect(featured.map((f) => f.id)).toEqual([b.id])
    })
  })

  describe("F22 — สมัครสมาชิกและสะสมแต้ม", () => {
    /// เปิดโต๊ะ → สั่ง 260 บาท → ปิดบิล แล้วคืน qrToken ให้ลูกค้าใช้สมัคร
    async function paidTable() {
      const table = await createTestTable()
      const qr = await createTestQrCode(table.id, { type: "DYNAMIC" })
      const opened = await openTableSession(makeFormData({ qrToken: qr.token }))
      const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""

      const menu = await createTestMenuItem({ name: "ข้าวผัด", price: "130.00" })
      const order = await createTestOrder(sessionId)
      await createTestOrderItem(order.id, menu.id, { quantity: 2, unitPrice: "130.00" })

      const paid = await confirmMobilePayment(makeFormData({ sessionId, paymentMethod: "PROMPTPAY" }))
      expect(paid.ok).toBe(true)
      return { qrToken: qr.token, sessionId }
    }

    it("ร้านที่ยังไม่เปิด CRM สมัครไม่ได้", async () => {
      const { qrToken } = await paidTable()
      const result = await registerMember(makeFormData({ qrToken, phone: "0812345678" }))
      expect(result.ok).toBe(false)
      expect(await testPrisma().member.count()).toBe(0)
    })

    it("สมัครแล้วได้แต้มตามยอดบิลทันที (1 แต้ม/25 บาท)", async () => {
      await updateStoreSettings(settingsForm({ crmEnabled: "true" }))
      const { qrToken } = await paidTable()

      const result = await registerMember(makeFormData({ qrToken, phone: "081-234-5678" }))
      expect(result.ok).toBe(true)
      // 260 / 25 = 10.4 → ปัดลงเป็น 10
      if (result.ok) expect(result.data).toMatchObject({ earnedPoints: 10, pointBalance: 10 })

      // เบอร์ถูก normalize เป็นตัวเลขล้วน ไม่งั้น unique กันซ้ำไม่ได้จริง
      const member = await testPrisma().member.findUnique({ where: { storeId_phone: { storeId: TEST_STORE_ID, phone: "0812345678" } } })
      expect(member?.pointBalance).toBe(10)
    })

    it("เบอร์เดิมสมัครซ้ำ = เข้าบัญชีเดิม ไม่สร้างสมาชิกใหม่", async () => {
      await updateStoreSettings(settingsForm({ crmEnabled: "true" }))
      const first = await paidTable()
      await registerMember(makeFormData({ qrToken: first.qrToken, phone: "0812345678" }))

      const second = await paidTable()
      const result = await registerMember(makeFormData({ qrToken: second.qrToken, phone: "0812345678" }))

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data?.pointBalance).toBe(20)
      expect(await testPrisma().member.count()).toBe(1)
    })

    it("กดรับแต้มซ้ำด้วยบิลเดิมต้องไม่ได้แต้มเพิ่ม (unique saleId)", async () => {
      await updateStoreSettings(settingsForm({ crmEnabled: "true" }))
      const { qrToken } = await paidTable()

      await registerMember(makeFormData({ qrToken, phone: "0812345678" }))
      const again = await registerMember(makeFormData({ qrToken, phone: "0812345678" }))

      expect(again.ok).toBe(true)
      if (again.ok) expect(again.data?.pointBalance).toBe(10)
      expect(await testPrisma().memberPointTransaction.count()).toBe(1)
    })

    it("โต๊ะที่ยังไม่ปิดบิล สมัครรับแต้มไม่ได้", async () => {
      await updateStoreSettings(settingsForm({ crmEnabled: "true" }))
      const table = await createTestTable()
      const qr = await createTestQrCode(table.id)
      await openTableSession(makeFormData({ qrToken: qr.token }))

      const result = await registerMember(makeFormData({ qrToken: qr.token, phone: "0812345678" }))
      expect(result.ok).toBe(false)
      expect(await testPrisma().memberPointTransaction.count()).toBe(0)
    })

    it("เบอร์โทรผิดรูปแบบต้องถูกปฏิเสธ", async () => {
      await updateStoreSettings(settingsForm({ crmEnabled: "true" }))
      const { qrToken } = await paidTable()

      for (const bad of ["123", "9812345678", "08123456789"]) {
        const result = await registerMember(makeFormData({ qrToken, phone: bad }))
        expect(result.ok).toBe(false)
      }
      expect(await testPrisma().member.count()).toBe(0)
    })
  })
})
