import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { SubmitOrderResult } from "@/app/actions/customer-order"
import {
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

describe.skipIf(!dbReady)("ลูกค้าสั่งอาหารผ่าน QR (Phase 9)", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let submitOrder: (formData: FormData) => Promise<ActionResult<SubmitOrderResult>>
  let callStaff: (formData: FormData) => Promise<ActionResult>
  let requestBill: (formData: FormData) => Promise<ActionResult<{ total: number }>>
  let generateQRCode: (formData: FormData) => Promise<ActionResult<{ token: string }>>
  let invalidateQRCode: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const customer = await import("@/app/actions/customer-order")
    const qr = await import("@/app/actions/qr-codes")
    openTableSession = tables.openTableSession
    submitOrder = customer.submitOrder
    callStaff = customer.callStaff
    requestBill = customer.requestBill
    generateQRCode = qr.generateQRCode
    invalidateQRCode = qr.invalidateQRCode
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
    await setStoreSettings({ hasKDS: true })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// เมนู 1 รายการ ราคา 100 พร้อมกลุ่มบังคับเลือก (เผ็ด) และกลุ่มไม่บังคับ (ท็อปปิ้ง +15)
  async function seedMenu() {
    const menuItem = await testPrisma().menuItem.create({
      data: {
        storeId: TEST_STORE_ID,
        name: "ข้าวกะเพราทดสอบ",
        price: "100.00",
        modifierGroups: {
          create: [
            {
              storeId: TEST_STORE_ID,
              name: "ระดับความเผ็ด",
              selectionType: "SINGLE",
              required: true,
              sortOrder: 1,
              options: { create: [{ name: "เผ็ดน้อย", priceDelta: "0.00", sortOrder: 1 }] },
            },
            {
              storeId: TEST_STORE_ID,
              name: "ท็อปปิ้งเพิ่ม",
              selectionType: "MULTIPLE",
              required: false,
              sortOrder: 2,
              options: { create: [{ name: "ไข่ดาว", priceDelta: "15.00", sortOrder: 1 }] },
            },
          ],
        },
      },
      include: { modifierGroups: { include: { options: true } } },
    })

    const spicy = menuItem.modifierGroups.find((g) => g.required)!
    const topping = menuItem.modifierGroups.find((g) => !g.required)!
    return { menuItem, spicyOptionId: spicy.options[0].id, toppingOptionId: topping.options[0].id }
  }

  async function openTable(code: string) {
    const table = await createTestTable(code)
    const qr = await createTestQrCode(table.id)
    const opened = await openTableSession(makeFormData({ qrToken: qr.token }))
    const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""
    return { table, qr, sessionId }
  }

  function orderForm(qrToken: string, items: unknown) {
    const formData = new FormData()
    formData.set("qrToken", qrToken)
    formData.set("items", JSON.stringify(items))
    return formData
  }

  describe("ยืนยันออร์เดอร์", () => {
    it("ราคาเป็น snapshot รวม modifier และโต๊ะเปลี่ยนเป็นสั่งแล้ว", async () => {
      // arrange
      const { qr, table } = await openTable("41")
      const { menuItem, spicyOptionId, toppingOptionId } = await seedMenu()

      // act
      const result = await submitOrder(
        orderForm(qr.token, [
          {
            menuItemId: menuItem.id,
            quantity: 2,
            optionIds: [spicyOptionId, toppingOptionId],
            note: "ไม่ใส่ผักชี",
          },
        ]),
      )

      // assert
      expect(result.ok).toBe(true)
      expect(result.ok === true && result.data?.orderNumber).toBe(1)

      const item = await testPrisma().mobileOrderItem.findFirstOrThrow()
      expect(Number(item.unitPrice)).toBe(115)
      expect(item.quantity).toBe(2)
      expect(item.note).toBe("ไม่ใส่ผักชี")
      expect(item.status).toBe("AWAITING_KITCHEN")
      expect(item.selectedOptionsSnapshot).toEqual([
        { groupName: "ระดับความเผ็ด", optionName: "เผ็ดน้อย", priceDelta: 0 },
        { groupName: "ท็อปปิ้งเพิ่ม", optionName: "ไข่ดาว", priceDelta: 15 },
      ])

      const after = await testPrisma().table.findUniqueOrThrow({ where: { id: table.id } })
      expect(after.status).toBe("ORDERED")
    })

    it("ราคาที่บันทึกไม่เปลี่ยนตามราคาเมนูที่แก้ทีหลัง", async () => {
      // arrange
      const { qr } = await openTable("42")
      const { menuItem, spicyOptionId } = await seedMenu()
      await submitOrder(
        orderForm(qr.token, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]),
      )

      // act
      await testPrisma().menuItem.update({ where: { id: menuItem.id }, data: { price: "999.00" } })

      // assert
      const item = await testPrisma().mobileOrderItem.findFirstOrThrow()
      expect(Number(item.unitPrice)).toBe(100)
    })

    it("ไม่เลือกกลุ่มที่บังคับต้องถูกปฏิเสธ และไม่มีออร์เดอร์เกิดขึ้น", async () => {
      // arrange
      const { qr } = await openTable("43")
      const { menuItem } = await seedMenu()

      // act
      const result = await submitOrder(
        orderForm(qr.token, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [] }]),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ระดับความเผ็ด")
      expect(await testPrisma().mobileOrder.count()).toBe(0)
    })

    it("สั่งเพิ่มในเซสชันเดิมได้ และเลขรอบสั่งเดินต่อ", async () => {
      // arrange
      const { qr } = await openTable("44")
      const { menuItem, spicyOptionId } = await seedMenu()
      const line = [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]

      // act
      const first = await submitOrder(orderForm(qr.token, line))
      const second = await submitOrder(orderForm(qr.token, line))

      // assert
      expect(first.ok === true && first.data?.orderNumber).toBe(1)
      expect(second.ok === true && second.data?.orderNumber).toBe(2)
      expect(await testPrisma().mobileOrder.count()).toBe(2)
    })

    it("QR ที่ถูกยกเลิกแล้วสั่งอาหารไม่ได้", async () => {
      // arrange
      const { qr } = await openTable("45")
      const { menuItem, spicyOptionId } = await seedMenu()
      await testPrisma().qRCode.update({
        where: { id: qr.id },
        data: { status: "INVALIDATED", invalidatedAt: new Date() },
      })

      // act
      const result = await submitOrder(
        orderForm(qr.token, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ใช้ไม่ได้แล้ว")
    })

    it("ตะกร้าว่างต้องถูกปฏิเสธด้วยข้อความไทย", async () => {
      // arrange
      const { qr } = await openTable("46")

      // act
      const result = await submitOrder(orderForm(qr.token, []))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("กรุณาเลือกเมนูก่อนยืนยันออร์เดอร์")
    })
  })

  describe("เรียกพนักงาน / เช็กบิล", () => {
    it("เรียกพนักงานสร้างการแจ้งเตือน และกดซ้ำไม่สร้างใบใหม่", async () => {
      // arrange
      const { qr, sessionId } = await openTable("47")

      // act
      await callStaff(makeFormData({ qrToken: qr.token, reason: "ขอน้ำเปล่า" }))
      await callStaff(makeFormData({ qrToken: qr.token, reason: "ขอช้อนเพิ่ม" }))

      // assert
      const notifications = await testPrisma().notification.findMany({
        where: { tableSessionId: sessionId, type: "CALL_STAFF" },
      })
      expect(notifications).toHaveLength(1)
      expect(notifications[0].reason).toBe("ขอช้อนเพิ่ม")
      expect(notifications[0].status).toBe("PENDING")
    })

    it("เช็กบิลตั้งสถานะรอเช็กบิลทั้ง session และโต๊ะ พร้อมคืนยอดรวม", async () => {
      // arrange
      const { qr, table, sessionId } = await openTable("48")
      const { menuItem, spicyOptionId } = await seedMenu()
      await submitOrder(
        orderForm(qr.token, [{ menuItemId: menuItem.id, quantity: 3, optionIds: [spicyOptionId] }]),
      )

      // act
      const result = await requestBill(makeFormData({ qrToken: qr.token }))

      // assert
      expect(result.ok).toBe(true)
      expect(result.ok === true && result.data?.total).toBe(300)

      const session = await testPrisma().tableSession.findUniqueOrThrow({ where: { id: sessionId } })
      expect(session.status).toBe("AWAITING_BILL")

      const after = await testPrisma().table.findUniqueOrThrow({ where: { id: table.id } })
      expect(after.status).toBe("AWAITING_BILL")

      const notification = await testPrisma().notification.findFirstOrThrow({
        where: { tableSessionId: sessionId, type: "CHECK_BILL" },
      })
      expect(notification.status).toBe("PENDING")
    })

    it("โต๊ะที่ขอเช็กบิลแล้วสั่งอาหารเพิ่มไม่ได้", async () => {
      // arrange
      const { qr } = await openTable("49")
      const { menuItem, spicyOptionId } = await seedMenu()
      await submitOrder(
        orderForm(qr.token, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]),
      )
      await requestBill(makeFormData({ qrToken: qr.token }))

      // act
      const result = await submitOrder(
        orderForm(qr.token, [{ menuItemId: menuItem.id, quantity: 1, optionIds: [spicyOptionId] }]),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("เช็กบิล")
    })
  })

  describe("จัดการ QR Code (F20)", () => {
    it("สร้าง QR ใบใหม่แล้วใบเก่าต้องถูกยกเลิกทันที (1 ใบต่อโต๊ะ)", async () => {
      // arrange
      const table = await createTestTable("50")
      const first = await createTestQrCode(table.id)

      // act
      const result = await generateQRCode(makeFormData({ tableId: table.id, type: "DYNAMIC" }))

      // assert
      expect(result.ok).toBe(true)

      const codes = await testPrisma().qRCode.findMany({ where: { tableId: table.id } })
      expect(codes).toHaveLength(2)
      expect(codes.filter((c) => c.status === "ACTIVE")).toHaveLength(1)

      const old = codes.find((c) => c.id === first.id)
      expect(old?.status).toBe("INVALIDATED")
      expect(old?.invalidatedAt).not.toBeNull()
    })

    it("token ที่สร้างต้องยาวพอและไม่ใช่ tableId", async () => {
      // arrange
      const table = await createTestTable("51")

      // act
      const result = await generateQRCode(makeFormData({ tableId: table.id, type: "STATIC" }))

      // assert
      const token = result.ok === true ? (result.data?.token ?? "") : ""
      expect(token.length).toBeGreaterThanOrEqual(24)
      expect(token).not.toBe(table.id)
    })

    it("ยกเลิก QR ซ้ำต้องถูกปฏิเสธ", async () => {
      // arrange
      const table = await createTestTable("52")
      const qr = await createTestQrCode(table.id)
      await invalidateQRCode(makeFormData({ id: qr.id }))

      // act
      const result = await invalidateQRCode(makeFormData({ id: qr.id }))

      // assert
      expect(result.ok).toBe(false)
    })
  })
})
