import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { OpenSessionResult } from "@/app/actions/tables"
import {
  createTestMenuItem,
  createTestQrCode,
  createTestTable,
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("MJD Mobile Order — เปิด/รวม/ยกเลิกโต๊ะ (Phase 6)", () => {
  let openTableSession: (formData: FormData) => Promise<ActionResult<OpenSessionResult>>
  let mergeTables: (formData: FormData) => Promise<ActionResult>
  let unmergeTables: (formData: FormData) => Promise<ActionResult>
  let cancelTableSession: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const actions = await import("@/app/actions/tables")
    openTableSession = actions.openTableSession
    mergeTables = actions.mergeTables
    unmergeTables = actions.unmergeTables
    cancelTableSession = actions.cancelTableSession
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  describe("เปิดโต๊ะ", () => {
    it("เปิดโต๊ะว่างต้องสร้าง session ใหม่และตั้งสถานะโต๊ะเป็น OPEN_NO_ORDER", async () => {
      // arrange
      const table = await createTestTable("01")

      // act
      const result = await openTableSession(makeFormData({ tableId: table.id }))

      // assert
      expect(result.ok).toBe(true)
      expect(result.ok === true && result.data?.reused).toBe(false)

      const session = await testPrisma().tableSession.findFirstOrThrow()
      expect(session.tableId).toBe(table.id)
      expect(session.status).toBe("OPEN")
      expect(session.openedAt).toBeInstanceOf(Date)

      const after = await testPrisma().table.findUniqueOrThrow({ where: { id: table.id } })
      expect(after.status).toBe("OPEN_NO_ORDER")
    })

    it("สแกนซ้ำที่โต๊ะที่เปิดอยู่แล้วต้องได้ session เดิม ไม่สร้างซ้ำ", async () => {
      // arrange
      const table = await createTestTable("02")
      const qr = await createTestQrCode(table.id)
      const first = await openTableSession(makeFormData({ qrToken: qr.token }))

      // act
      const second = await openTableSession(makeFormData({ qrToken: qr.token }))

      // assert
      expect(second.ok).toBe(true)
      expect(second.ok === true && second.data?.reused).toBe(true)
      expect(second.ok === true && second.data?.sessionId).toBe(
        first.ok === true ? first.data?.sessionId : undefined,
      )
      expect(await testPrisma().tableSession.count()).toBe(1)
    })

    it("สแกนพร้อมกัน 5 ครั้งต้องได้ session เดียวเท่านั้น (กัน race)", async () => {
      // arrange
      const table = await createTestTable("03")
      const qr = await createTestQrCode(table.id)

      // act
      const results = await Promise.all(
        Array.from({ length: 5 }, () => openTableSession(makeFormData({ qrToken: qr.token }))),
      )

      // assert
      expect(results.every((r) => r.ok)).toBe(true)
      expect(await testPrisma().tableSession.count()).toBe(1)

      const ids = new Set(results.map((r) => (r.ok ? r.data?.sessionId : "x")))
      expect(ids.size).toBe(1)
    })

    it("QR ที่ถูก invalidate แล้วต้องเปิดโต๊ะไม่ได้", async () => {
      // arrange
      const table = await createTestTable("04")
      const qr = await createTestQrCode(table.id, { type: "DYNAMIC", status: "INVALIDATED" })

      // act
      const result = await openTableSession(makeFormData({ qrToken: qr.token }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("แจ้งพนักงาน")
      expect(await testPrisma().tableSession.count()).toBe(0)
    })

    it("QR ที่ไม่มีในระบบต้องคืนข้อความภาษาไทย ไม่ throw", async () => {
      // act
      const result = await openTableSession(makeFormData({ qrToken: "ไม่มีโทเคนนี้" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ไม่พบ QR Code")
    })

    it("สแกน QR ของโต๊ะรองที่ถูกรวมแล้ว ต้องเด้งไป session ของโต๊ะหลัก", async () => {
      // arrange
      const primary = await createTestTable("05")
      const secondary = await createTestTable("06")
      const secondaryQr = await createTestQrCode(secondary.id)
      const opened = await openTableSession(makeFormData({ tableId: primary.id }))
      await mergeTables(makeFormData({ primaryTableId: primary.id, secondaryTableId: secondary.id }))

      // act
      const result = await openTableSession(makeFormData({ qrToken: secondaryQr.token }))

      // assert
      expect(result.ok).toBe(true)
      expect(result.ok === true && result.data?.sessionId).toBe(
        opened.ok === true ? opened.data?.sessionId : undefined,
      )
      expect(await testPrisma().tableSession.count()).toBe(1)
    })
  })

  describe("รวมโต๊ะ / ยกเลิกการรวม", () => {
    it("รวมโต๊ะว่างเข้ากับโต๊ะหลักที่เปิดอยู่ได้ และโต๊ะรองเปลี่ยนเป็น OCCUPIED_MERGED", async () => {
      // arrange
      const primary = await createTestTable("07")
      const secondary = await createTestTable("08")
      await openTableSession(makeFormData({ tableId: primary.id }))

      // act
      const result = await mergeTables(
        makeFormData({ primaryTableId: primary.id, secondaryTableId: secondary.id }),
      )

      // assert
      expect(result.ok).toBe(true)
      const after = await testPrisma().table.findUniqueOrThrow({ where: { id: secondary.id } })
      expect(after.status).toBe("OCCUPIED_MERGED")
      expect(after.primaryTableId).toBe(primary.id)
    })

    it("รวมโต๊ะที่ไม่ว่างไม่ได้", async () => {
      // arrange — โต๊ะรองเปิดใช้งานอยู่
      const primary = await createTestTable("09")
      const secondary = await createTestTable("10")
      await openTableSession(makeFormData({ tableId: primary.id }))
      await openTableSession(makeFormData({ tableId: secondary.id }))

      // act
      const result = await mergeTables(
        makeFormData({ primaryTableId: primary.id, secondaryTableId: secondary.id }),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ไม่ว่าง")
      const after = await testPrisma().table.findUniqueOrThrow({ where: { id: secondary.id } })
      expect(after.primaryTableId).toBeNull()
    })

    it("โต๊ะหลักที่ยังไม่เปิดใช้งาน รวมโต๊ะไม่ได้", async () => {
      // arrange
      const primary = await createTestTable("11")
      const secondary = await createTestTable("12")

      // act
      const result = await mergeTables(
        makeFormData({ primaryTableId: primary.id, secondaryTableId: secondary.id }),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain("ยังไม่ได้เปิดใช้งาน")
    })

    it("รวมโต๊ะกับตัวเองไม่ได้", async () => {
      // arrange
      const table = await createTestTable("13")

      // act
      const result = await mergeTables(
        makeFormData({ primaryTableId: table.id, secondaryTableId: table.id }),
      )

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("รวมโต๊ะกับตัวเองไม่ได้")
    })

    it("ยกเลิกการรวมโต๊ะแล้วโต๊ะรองต้องกลับเป็นว่าง", async () => {
      // arrange
      const primary = await createTestTable("14")
      const secondary = await createTestTable("15")
      await openTableSession(makeFormData({ tableId: primary.id }))
      await mergeTables(makeFormData({ primaryTableId: primary.id, secondaryTableId: secondary.id }))

      // act
      const result = await unmergeTables(makeFormData({ secondaryTableId: secondary.id }))

      // assert
      expect(result.ok).toBe(true)
      const after = await testPrisma().table.findUniqueOrThrow({ where: { id: secondary.id } })
      expect(after.status).toBe("EMPTY")
      expect(after.primaryTableId).toBeNull()
    })
  })

  describe("ยกเลิกโต๊ะทั้งชุด", () => {
    it("ยกเลิกโต๊ะต้องยกเลิกรายการอาหารที่ยังไม่เสิร์ฟ คืนโต๊ะเป็นว่าง และไม่สร้างบิล", async () => {
      // arrange
      const table = await createTestTable("16")
      const menuItem = await createTestMenuItem()
      const opened = await openTableSession(makeFormData({ tableId: table.id }))
      const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""

      const order = await testPrisma().mobileOrder.create({
        data: { storeId: TEST_STORE_ID, tableSessionId: sessionId, orderNumber: 1 },
      })
      await testPrisma().mobileOrderItem.createMany({
        data: [
          { mobileOrderId: order.id, menuItemId: menuItem.id, quantity: 1, unitPrice: "80.00" },
          {
            mobileOrderId: order.id,
            menuItemId: menuItem.id,
            quantity: 2,
            unitPrice: "80.00",
            status: "SERVED",
          },
        ],
      })

      // act
      const result = await cancelTableSession(makeFormData({ sessionId, reason: "ลูกค้าไม่มาแล้ว" }))

      // assert
      expect(result.ok).toBe(true)

      const session = await testPrisma().tableSession.findUniqueOrThrow({ where: { id: sessionId } })
      expect(session.status).toBe("CANCELLED")
      expect(session.cancelReason).toBe("ลูกค้าไม่มาแล้ว")
      expect(session.closedById).toBe("test-user")

      const items = await testPrisma().mobileOrderItem.findMany({ orderBy: { quantity: "asc" } })
      expect(items[0].status).toBe("CANCELLED")
      // รายการที่เสิร์ฟไปแล้วต้องไม่ถูกแตะ
      expect(items[1].status).toBe("SERVED")

      const after = await testPrisma().table.findUniqueOrThrow({ where: { id: table.id } })
      expect(after.status).toBe("EMPTY")

      expect(await testPrisma().sale.count()).toBe(0)
    })

    it("ยกเลิกโต๊ะที่รวมอยู่ ต้องคืนโต๊ะรองเป็นว่างด้วยในทรานแซคชันเดียว", async () => {
      // arrange
      const primary = await createTestTable("17")
      const secondary = await createTestTable("18")
      const opened = await openTableSession(makeFormData({ tableId: primary.id }))
      const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""
      await mergeTables(makeFormData({ primaryTableId: primary.id, secondaryTableId: secondary.id }))

      // act
      const result = await cancelTableSession(makeFormData({ sessionId, reason: "ยกเลิกทั้งกลุ่ม" }))

      // assert
      expect(result.ok).toBe(true)
      const rows = await testPrisma().table.findMany({ orderBy: { code: "asc" } })
      expect(rows.every((t) => t.status === "EMPTY")).toBe(true)
      expect(rows.every((t) => t.primaryTableId === null)).toBe(true)
    })

    it("ยกเลิกโต๊ะซ้ำต้องถูกปฏิเสธ", async () => {
      // arrange
      const table = await createTestTable("19")
      const opened = await openTableSession(makeFormData({ tableId: table.id }))
      const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""
      await cancelTableSession(makeFormData({ sessionId, reason: "รอบแรก" }))

      // act
      const second = await cancelTableSession(makeFormData({ sessionId, reason: "รอบสอง" }))

      // assert
      expect(second.ok).toBe(false)
      expect(second.ok === false && second.error).toContain("ถูกปิดหรือยกเลิกไปแล้ว")
    })

    it("ยกเลิกโต๊ะโดยไม่ระบุเหตุผลต้องถูกปฏิเสธ", async () => {
      // arrange
      const table = await createTestTable("20")
      const opened = await openTableSession(makeFormData({ tableId: table.id }))
      const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""

      // act
      const result = await cancelTableSession(makeFormData({ sessionId, reason: "" }))

      // assert
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toBe("กรุณาระบุเหตุผลที่ยกเลิกโต๊ะ")
    })
  })
})
