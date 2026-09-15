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
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("จัดการโต๊ะและเมนู (master data)", () => {
  let createTable: (formData: FormData) => Promise<ActionResult>
  let createTablesBulk: (formData: FormData) => Promise<ActionResult>
  let renameTable: (formData: FormData) => Promise<ActionResult>
  let deleteTable: (formData: FormData) => Promise<ActionResult>
  let openTableSession: (formData: FormData) => Promise<ActionResult<{ sessionId: string }>>
  let saveMenuItem: (formData: FormData) => Promise<ActionResult>
  let deleteMenuItem: (formData: FormData) => Promise<ActionResult>
  let toggleMenuItemActive: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const tables = await import("@/app/actions/tables")
    const menu = await import("@/app/actions/menu")
    createTable = tables.createTable
    createTablesBulk = tables.createTablesBulk
    renameTable = tables.renameTable
    deleteTable = tables.deleteTable
    openTableSession = tables.openTableSession
    saveMenuItem = menu.saveMenuItem
    deleteMenuItem = menu.deleteMenuItem
    toggleMenuItemActive = menu.toggleMenuItemActive
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  describe("โต๊ะ", () => {
    it("เพิ่มโต๊ะทีละตัวได้ และรหัสซ้ำถูกปฏิเสธ", async () => {
      const db = testPrisma()
      expect((await createTable(makeFormData({ code: "A1" }))).ok).toBe(true)

      const duplicate = await createTable(makeFormData({ code: "A1" }))
      expect(duplicate.ok).toBe(false)
      if (!duplicate.ok) expect(duplicate.error).toContain("มีโต๊ะรหัส")
      expect(await db.table.count()).toBe(1)
    })

    it("รหัสที่มีอักขระแปลกถูกปฏิเสธ", async () => {
      for (const code of ["", "   ", "A/1", "โต๊ะ 1", "A@1"]) {
        expect((await createTable(makeFormData({ code }))).ok).toBe(false)
      }
      expect(await testPrisma().table.count()).toBe(0)
    })

    it("เพิ่มเป็นชุดแล้วเติมศูนย์ให้เท่ากับจำนวนหลักของเลขท้าย", async () => {
      const db = testPrisma()
      const result = await createTablesBulk(makeFormData({ prefix: "T", from: "1", to: "12" }))
      expect(result.ok).toBe(true)

      const codes = (await db.table.findMany({ orderBy: { code: "asc" }, select: { code: true } })).map(
        (t) => t.code,
      )
      expect(codes).toHaveLength(12)
      expect(codes[0]).toBe("T01")
      expect(codes[11]).toBe("T12")
    })

    it("เพิ่มชุดซ้ำ — ข้ามตัวที่มีอยู่แล้ว ไม่ล้มทั้งชุด", async () => {
      const db = testPrisma()
      await createTablesBulk(makeFormData({ prefix: "T", from: "1", to: "5" }))
      const again = await createTablesBulk(makeFormData({ prefix: "T", from: "1", to: "8" }))

      expect(again.ok).toBe(true)
      if (again.ok) expect(again.message).toContain("ข้าม")
      expect(await db.table.count()).toBe(8)
    })

    it("ช่วงที่กว้างเกิน 100 ตัวถูกปฏิเสธ", async () => {
      const result = await createTablesBulk(makeFormData({ prefix: "T", from: "1", to: "200" }))
      expect(result.ok).toBe(false)
      expect(await testPrisma().table.count()).toBe(0)
    })

    it("แก้รหัสโต๊ะที่ว่างได้ แต่โต๊ะที่เปิดอยู่แก้ไม่ได้", async () => {
      const db = testPrisma()
      const table = await createTestTable("B1")

      expect((await renameTable(makeFormData({ id: table.id, code: "B2" }))).ok).toBe(true)
      expect((await db.table.findUniqueOrThrow({ where: { id: table.id } })).code).toBe("B2")

      await openTableSession(makeFormData({ tableId: table.id }))
      const blocked = await renameTable(makeFormData({ id: table.id, code: "B3" }))
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) expect(blocked.error).toContain("กำลังเปิดอยู่")
      expect((await db.table.findUniqueOrThrow({ where: { id: table.id } })).code).toBe("B2")
    })

    it("ลบโต๊ะที่ยังไม่เคยเปิดได้ และ QR ของโต๊ะนั้นถูกลบตาม", async () => {
      const db = testPrisma()
      const table = await createTestTable("C1")
      await createTestQrCode(table.id)

      const result = await deleteTable(makeFormData({ id: table.id }))
      expect(result.ok).toBe(true)
      expect(await db.table.count()).toBe(0)
      expect(await db.qRCode.count()).toBe(0)
    })

    it("ลบโต๊ะที่เคยเปิดใช้งานแล้วไม่ได้ — ผูกกับบิลที่ออกไปแล้ว", async () => {
      const db = testPrisma()
      const table = await createTestTable("C2")
      const opened = await openTableSession(makeFormData({ tableId: table.id }))
      expect(opened.ok).toBe(true)

      // ปิด session ให้โต๊ะกลับเป็นว่างก่อน จะได้พิสูจน์ว่าเงื่อนไขที่กันคือ "ประวัติ" ไม่ใช่ "กำลังเปิด"
      await db.tableSession.updateMany({ where: { tableId: table.id }, data: { status: "CLOSED" } })
      await db.table.update({ where: { id: table.id }, data: { status: "EMPTY" } })

      const result = await deleteTable(makeFormData({ id: table.id }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("เคยเปิดใช้งาน")
      expect(await db.table.count()).toBe(1)
    })
  })

  describe("เมนู", () => {
    it("เพิ่มเมนูพร้อมตัวเลือกเสริมได้", async () => {
      const db = testPrisma()
      const result = await saveMenuItem(
        makeFormData({
          name: "ผัดกะเพรา",
          description: "เผ็ดกลาง",
          price: "80",
          imageUrl: "",
          isActive: "true",
          modifierGroups: JSON.stringify([
            {
              name: "ระดับความเผ็ด",
              selectionType: "SINGLE",
              required: true,
              options: [
                { name: "ไม่เผ็ด", priceDelta: 0 },
                { name: "เผ็ดมาก", priceDelta: 0 },
              ],
            },
            {
              name: "เพิ่มเติม",
              selectionType: "MULTIPLE",
              required: false,
              options: [{ name: "ไข่ดาว", priceDelta: 10 }],
            },
          ]),
        }),
      )
      expect(result.ok).toBe(true)

      const item = await db.menuItem.findFirstOrThrow({
        include: { modifierGroups: { include: { options: true }, orderBy: { sortOrder: "asc" } } },
      })
      expect(Number(item.price)).toBe(80)
      expect(item.modifierGroups).toHaveLength(2)
      expect(item.modifierGroups[0]?.required).toBe(true)
      expect(item.modifierGroups[1]?.options[0]?.name).toBe("ไข่ดาว")
      expect(Number(item.modifierGroups[1]?.options[0]?.priceDelta)).toBe(10)
    })

    it("แก้เมนูแล้วตัวเลือกเสริมถูกเขียนทับทั้งชุด ไม่ทิ้งของเก่าค้าง", async () => {
      const db = testPrisma()
      await saveMenuItem(
        makeFormData({
          name: "ข้าวมันไก่",
          price: "60",
          imageUrl: "",
          isActive: "true",
          modifierGroups: JSON.stringify([
            { name: "กลุ่มเก่า", selectionType: "SINGLE", required: false, options: [{ name: "ก", priceDelta: 0 }] },
          ]),
        }),
      )
      const created = await db.menuItem.findFirstOrThrow()

      await saveMenuItem(
        makeFormData({
          id: created.id,
          name: "ข้าวมันไก่ทอด",
          price: "70",
          imageUrl: "",
          isActive: "true",
          modifierGroups: JSON.stringify([
            { name: "กลุ่มใหม่", selectionType: "MULTIPLE", required: false, options: [{ name: "ข", priceDelta: 5 }] },
          ]),
        }),
      )

      const updated = await db.menuItem.findFirstOrThrow({ include: { modifierGroups: true } })
      expect(updated.name).toBe("ข้าวมันไก่ทอด")
      expect(Number(updated.price)).toBe(70)
      expect(updated.modifierGroups).toHaveLength(1)
      expect(updated.modifierGroups[0]?.name).toBe("กลุ่มใหม่")
      expect(await db.modifierOption.count()).toBe(1)
    })

    it("กลุ่มที่ไม่มีตัวเลือกหรือไม่มีชื่อถูกปฏิเสธพร้อมบอกว่ากลุ่มไหน", async () => {
      const noOptions = await saveMenuItem(
        makeFormData({
          name: "เมนู",
          price: "10",
          imageUrl: "",
          isActive: "true",
          modifierGroups: JSON.stringify([
            { name: "กลุ่มว่าง", selectionType: "SINGLE", required: false, options: [] },
          ]),
        }),
      )
      expect(noOptions.ok).toBe(false)
      if (!noOptions.ok) expect(noOptions.error).toContain("กลุ่มว่าง")

      const noName = await saveMenuItem(
        makeFormData({
          name: "เมนู",
          price: "10",
          imageUrl: "",
          isActive: "true",
          modifierGroups: JSON.stringify([
            { name: "", selectionType: "SINGLE", required: false, options: [{ name: "ก", priceDelta: 0 }] },
          ]),
        }),
      )
      expect(noName.ok).toBe(false)
      expect(await testPrisma().menuItem.count()).toBe(0)
    })

    it("ลิงก์รูปที่ไม่ปลอดภัยถูกปฏิเสธ", async () => {
      const result = await saveMenuItem(
        makeFormData({
          name: "เมนู",
          price: "10",
          imageUrl: "javascript:alert(1)",
          isActive: "true",
          modifierGroups: "[]",
        }),
      )
      expect(result.ok).toBe(false)
      expect(await testPrisma().menuItem.count()).toBe(0)
    })

    it("สลับเปิด/ปิดขายได้", async () => {
      const db = testPrisma()
      const item = await createTestMenuItem({ name: "ต้มยำ" })

      expect((await toggleMenuItemActive(makeFormData({ id: item.id }))).ok).toBe(true)
      expect((await db.menuItem.findUniqueOrThrow({ where: { id: item.id } })).isActive).toBe(false)

      expect((await toggleMenuItemActive(makeFormData({ id: item.id }))).ok).toBe(true)
      expect((await db.menuItem.findUniqueOrThrow({ where: { id: item.id } })).isActive).toBe(true)
    })

    it("ลบเมนูที่ยังไม่เคยถูกสั่งได้ แต่เมนูที่เคยสั่งแล้วลบไม่ได้", async () => {
      const db = testPrisma()
      const unused = await createTestMenuItem({ name: "ยังไม่เคยขาย" })
      expect((await deleteMenuItem(makeFormData({ id: unused.id }))).ok).toBe(true)

      const used = await createTestMenuItem({ name: "เคยขายแล้ว" })
      const table = await createTestTable()
      const opened = await openTableSession(makeFormData({ tableId: table.id }))
      const sessionId = opened.ok === true ? (opened.data?.sessionId ?? "") : ""
      const order = await createTestOrder(sessionId)
      await createTestOrderItem(order.id, used.id)

      const blocked = await deleteMenuItem(makeFormData({ id: used.id }))
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) expect(blocked.error).toContain("ปิดใช้งานแทน")
      expect(await db.menuItem.count({ where: { id: used.id } })).toBe(1)
    })
  })
})
