import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import type { StaffOrderResult } from "@/app/actions/staff-order"
import {
  disconnectTestDb,
  ensureTestUser,
  isTestDbReachable,
  resetDb,
  setStoreSettings,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// ตัวเลือกร้านนวด (Phase 20a) — พนักงานนวด · โปรแกรมนวด (SERVICE) · ห้องนวด · ขายโปรแกรมต้องมีพนักงาน · ไม่เข้า KDS · ลงบิลพร้อม therapistId
describe.skipIf(!dbReady)("ร้านนวด — พนักงานนวด + โปรแกรมนวด (Phase 20a)", () => {
  let saveTherapist: (formData: FormData) => Promise<ActionResult>
  let deleteTherapist: (formData: FormData) => Promise<ActionResult>
  let toggleTherapistActive: (formData: FormData) => Promise<ActionResult>
  let saveMenuItem: (formData: FormData) => Promise<ActionResult>
  let createTable: (formData: FormData) => Promise<ActionResult>
  let createStaffTableOrder: (formData: FormData) => Promise<ActionResult<StaffOrderResult>>
  let assignOrderItemTherapist: (formData: FormData) => Promise<ActionResult>
  let startServiceItem: (formData: FormData) => Promise<ActionResult>
  let markItemServed: (formData: FormData) => Promise<ActionResult>
  let startCookingItem: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")
  let closeSessionWithPayment: typeof import("@/lib/close-session").closeSessionWithPayment

  beforeAll(async () => {
    const therapists = await import("@/app/actions/therapists")
    saveTherapist = therapists.saveTherapist
    deleteTherapist = therapists.deleteTherapist
    toggleTherapistActive = therapists.toggleTherapistActive
    saveMenuItem = (await import("@/app/actions/menu")).saveMenuItem
    createTable = (await import("@/app/actions/tables")).createTable
    createStaffTableOrder = (await import("@/app/actions/staff-order")).createStaffTableOrder
    const orders = await import("@/app/actions/orders")
    assignOrderItemTherapist = orders.assignOrderItemTherapist
    startServiceItem = orders.startServiceItem
    markItemServed = orders.markItemServed
    startCookingItem = orders.startCookingItem
    queries = await import("@/lib/queries")
    closeSessionWithPayment = (await import("@/lib/close-session")).closeSessionWithPayment
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({ hasKDS: true })
    await testPrisma().storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { spaEnabled: true } })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// ประเภทบริการ 2 · โปรแกรมนวดไทย 60 นาที (ต้องทักษะนวดไทย) · พนักงาน 001 (นวดไทย) และ 002 (นวดเท้าอย่างเดียว)
  async function seedSpa() {
    const db = testPrisma()
    const thai = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดไทย" } })
    const foot = await db.kitchenStation.create({ data: { storeId: TEST_STORE_ID, name: "นวดเท้า" } })
    const program = await db.menuItem.create({
      data: { storeId: TEST_STORE_ID, name: "นวดไทย 60", price: "300.00", itemType: "SERVICE", durationMinutes: 60, stationId: thai.id },
    })
    const food = await db.menuItem.create({ data: { storeId: TEST_STORE_ID, name: "น้ำขิง", price: "40.00", itemType: "FOOD" } })
    const t1 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด", skills: { connect: [{ id: thai.id }] } } })
    const t2 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "002", name: "หน่อย", skills: { connect: [{ id: foot.id }] } } })
    const room = await db.table.create({ data: { storeId: TEST_STORE_ID, code: "3/1", kind: "ROOM", stationId: thai.id } })
    return { thai, foot, program, food, t1, t2, room }
  }

  function orderForm(tableId: string, lines: { menuItemId: string; therapistId?: string; quantity?: number }[]) {
    return makeFormData({
      tableId,
      items: JSON.stringify(lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity ?? 1, optionIds: [], therapistId: l.therapistId }))),
    })
  }

  describe("พนักงานนวด (CRUD)", () => {
    it("เพิ่ม/แก้ พร้อมทักษะ · รหัสซ้ำถูกปฏิเสธ · รหัสถูกแปลงเป็นตัวพิมพ์ใหญ่", async () => {
      const { thai, foot } = await seedSpa()
      const created = await saveTherapist(makeFormData({ code: "t03", name: "สาม", nickname: "แซม", phone: "0812345678", gender: "F", startedAt: "2026-01-15", isActive: "true", skillIds: `${thai.id},${foot.id}` }))
      expect(created.ok).toBe(true)
      const row = (await queries.listTherapists(TEST_STORE_ID)).find((t) => t.code === "T03")
      expect(row).toBeDefined()
      expect(row?.skills.map((s) => s.name).sort()).toEqual(["นวดเท้า", "นวดไทย"])
      expect(row?.startedAt?.toISOString().slice(0, 10)).toBe("2026-01-15")

      const duplicate = await saveTherapist(makeFormData({ code: "T03", name: "ซ้ำ", isActive: "true", skillIds: "" }))
      expect(duplicate.ok).toBe(false)
      expect(duplicate.ok === false && duplicate.error).toContain("อยู่แล้ว")

      // แก้: ถอดทักษะเหลือนวดไทย + เปลี่ยนชื่อเล่น
      const edited = await saveTherapist(makeFormData({ id: row?.id ?? "", code: "T03", name: "สาม", nickname: "แซมมี่", isActive: "true", skillIds: thai.id }))
      expect(edited.ok).toBe(true)
      const after = await testPrisma().therapist.findUniqueOrThrow({ where: { id: row?.id ?? "" }, include: { skills: true } })
      expect(after.nickname).toBe("แซมมี่")
      expect(after.skills.map((s) => s.name)).toEqual(["นวดไทย"])
    })

    it("ทักษะที่ไม่ใช่ประเภทบริการของร้านถูกปฏิเสธ · ปิดใช้งานแล้วหายจากตัวเลือกจอขาย", async () => {
      const { t1 } = await seedSpa()
      const bad = await saveTherapist(makeFormData({ code: "009", name: "x", isActive: "true", skillIds: "no-such-station" }))
      expect(bad.ok).toBe(false)
      expect(bad.ok === false && bad.fieldErrors?.skillIds).toBeTruthy()

      expect((await queries.listTherapistOptions(TEST_STORE_ID)).map((t) => t.code).sort()).toEqual(["001", "002"])
      expect((await toggleTherapistActive(makeFormData({ id: t1.id }))).ok).toBe(true)
      expect((await queries.listTherapistOptions(TEST_STORE_ID)).map((t) => t.code)).toEqual(["002"])
    })

    it("ลบได้เฉพาะคนที่ไม่มีประวัติ — มีชื่อในออร์เดอร์แล้วต้องปิดใช้งานแทน", async () => {
      const { program, t1, t2, room } = await seedSpa()
      const order = await createStaffTableOrder(orderForm(room.id, [{ menuItemId: program.id, therapistId: t1.id }]))
      expect(order.ok).toBe(true)

      const blocked = await deleteTherapist(makeFormData({ id: t1.id }))
      expect(blocked.ok).toBe(false)
      expect(blocked.ok === false && blocked.error).toContain("ปิดใช้งานแทน")
      expect(await testPrisma().therapist.count({ where: { id: t1.id } })).toBe(1)

      expect((await deleteTherapist(makeFormData({ id: t2.id }))).ok).toBe(true)
      expect(await testPrisma().therapist.count({ where: { id: t2.id } })).toBe(0)
    })
  })

  describe("โปรแกรมนวด / ห้องนวด (master data)", () => {
    it("เมนูชนิด SERVICE ต้องระบุระยะเวลา · อาหารไม่เก็บระยะเวลา", async () => {
      const missing = await saveMenuItem(makeFormData({ name: "นวดอโรม่า", price: "500", imageUrl: "", isActive: "true", modifierGroups: "[]", itemType: "SERVICE", durationMinutes: "" }))
      expect(missing.ok).toBe(false)
      expect(missing.ok === false && missing.fieldErrors?.durationMinutes).toBeTruthy()

      const ok = await saveMenuItem(makeFormData({ name: "นวดอโรม่า", price: "500", imageUrl: "", isActive: "true", modifierGroups: "[]", itemType: "SERVICE", durationMinutes: "90" }))
      expect(ok.ok).toBe(true)
      const service = await testPrisma().menuItem.findFirstOrThrow({ where: { name: "นวดอโรม่า" } })
      expect(service.itemType).toBe("SERVICE")
      expect(service.durationMinutes).toBe(90)

      const food = await saveMenuItem(makeFormData({ name: "ชาเย็น", price: "35", imageUrl: "", isActive: "true", modifierGroups: "[]", itemType: "FOOD", durationMinutes: "30" }))
      expect(food.ok).toBe(true)
      expect((await testPrisma().menuItem.findFirstOrThrow({ where: { name: "ชาเย็น" } })).durationMinutes).toBeNull()

      const cards = await queries.listMenu(TEST_STORE_ID)
      expect(cards.all.find((c) => c.name === "นวดอโรม่า")?.durationMinutes).toBe(90)
    })

    it("สร้างห้องนวดพร้อมประเภทห้อง · โต๊ะอาหารไม่เก็บประเภท · ประเภทที่ไม่มีจริงถูกปฏิเสธ", async () => {
      const { thai } = await seedSpa()
      expect((await createTable(makeFormData({ code: "R1", kind: "ROOM", stationId: thai.id }))).ok).toBe(true)
      expect((await createTable(makeFormData({ code: "A1", kind: "TABLE", stationId: thai.id }))).ok).toBe(true)
      const bad = await createTable(makeFormData({ code: "R2", kind: "ROOM", stationId: "no-such" }))
      expect(bad.ok).toBe(false)

      const managed = await queries.listTablesForManage(TEST_STORE_ID)
      expect(managed.find((t) => t.code === "R1")).toMatchObject({ kind: "ROOM", stationName: "นวดไทย" })
      expect(managed.find((t) => t.code === "A1")).toMatchObject({ kind: "TABLE", stationId: null })
      const overview = await queries.listTableOverview(TEST_STORE_ID)
      expect(overview.find((t) => t.code === "R1")?.kind).toBe("ROOM")
    })
  })

  describe("ขายโปรแกรมนวดจากจอขาย", () => {
    it("บรรทัด SERVICE ต้องมีพนักงานนวด · พนักงานที่ทักษะไม่ตรงถูกปฏิเสธ · อาหารระบุพนักงานไม่ได้", async () => {
      const { program, food, t1, t2, room } = await seedSpa()

      const noTherapist = await createStaffTableOrder(orderForm(room.id, [{ menuItemId: program.id }]))
      expect(noTherapist.ok).toBe(false)
      expect(noTherapist.ok === false && noTherapist.error).toContain("กรุณาเลือกพนักงานนวด")

      const wrongSkill = await createStaffTableOrder(orderForm(room.id, [{ menuItemId: program.id, therapistId: t2.id }]))
      expect(wrongSkill.ok).toBe(false)
      expect(wrongSkill.ok === false && wrongSkill.error).toContain("ไม่มีทักษะ")

      const foodWithTherapist = await createStaffTableOrder(orderForm(room.id, [{ menuItemId: food.id, therapistId: t1.id }]))
      expect(foodWithTherapist.ok).toBe(false)

      // ไม่มีอะไรถูกเขียนลงฐานเลยจาก 3 คำขอที่ล้ม
      expect(await testPrisma().mobileOrder.count()).toBe(0)

      const ok = await createStaffTableOrder(orderForm(room.id, [{ menuItemId: program.id, therapistId: t1.id }, { menuItemId: food.id }]))
      expect(ok.ok).toBe(true)
      const items = await testPrisma().mobileOrderItem.findMany({ orderBy: { createdAt: "asc" } })
      expect(items.map((i) => i.therapistId)).toEqual([t1.id, null])
    })

    it("โปรแกรมนวดไม่ขึ้น KDS/ทิกเก็ตครัว — เฉพาะอาหารเท่านั้น", async () => {
      const { program, food, t1, room } = await seedSpa()
      const ok = await createStaffTableOrder(orderForm(room.id, [{ menuItemId: program.id, therapistId: t1.id }, { menuItemId: food.id }]))
      expect(ok.ok).toBe(true)
      const [ticket] = await queries.listKitchenTickets(TEST_STORE_ID)
      expect(ticket.items.map((i) => i.menuItemName)).toEqual(["น้ำขิง"])
      const orderId = (await testPrisma().mobileOrder.findFirstOrThrow()).id
      const doc = await queries.getKitchenTicket(TEST_STORE_ID, orderId)
      expect(doc?.items.map((i) => i.name)).toEqual(["น้ำขิง"])
      // หน้าห้องยังเห็นทั้งสองบรรทัดพร้อมพนักงานนวด
      const detail = await queries.getTableDetail(TEST_STORE_ID, room.id)
      const service = detail?.orders[0].items.find((i) => i.itemType === "SERVICE")
      expect(service?.therapistLabel).toBe("001 นิด")
      expect(service?.durationMinutes).toBe(60)
    })

    it("เริ่มนวด → นวดเสร็จ จากหน้าห้อง (ข้าม KDS แม้ร้านเปิด KDS) · ครัวกดเริ่มทำโปรแกรมนวดไม่ได้", async () => {
      const { program, t1, room } = await seedSpa()
      await createStaffTableOrder(orderForm(room.id, [{ menuItemId: program.id, therapistId: t1.id }]))
      const item = await testPrisma().mobileOrderItem.findFirstOrThrow()

      // เสิร์ฟ/เสร็จได้ตรงจาก AWAITING_KITCHEN ทั้งที่ hasKDS = true (อาหารทำแบบนี้ไม่ได้)
      const started = await startServiceItem(makeFormData({ id: item.id }))
      expect(started.ok).toBe(true)
      expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("COOKING")
      expect((await queries.listTherapists(TEST_STORE_ID)).find((t) => t.code === "001")?.busyNow).toBe(true)

      const done = await markItemServed(makeFormData({ id: item.id }))
      expect(done.ok).toBe(true)
      expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("SERVED")
      expect((await queries.listTherapists(TEST_STORE_ID)).find((t) => t.code === "001")?.busyNow).toBe(false)
    })

    it("มอบหมายพนักงานทีหลังได้ (ลูกค้าสั่งเองไม่มีพนักงาน) · เริ่มนวดก่อนมอบหมายไม่ได้ · ทักษะไม่ตรงถูกปฏิเสธ", async () => {
      const { program, t1, t2, room } = await seedSpa()
      const db = testPrisma()
      const session = await db.tableSession.create({ data: { storeId: TEST_STORE_ID, tableId: room.id } })
      const order = await db.mobileOrder.create({ data: { storeId: TEST_STORE_ID, tableSessionId: session.id, orderNumber: 1 } })
      const item = await db.mobileOrderItem.create({ data: { mobileOrderId: order.id, menuItemId: program.id, quantity: 1, unitPrice: "300.00" } })

      const tooEarly = await startServiceItem(makeFormData({ id: item.id }))
      expect(tooEarly.ok).toBe(false)
      expect(tooEarly.ok === false && tooEarly.error).toContain("มอบหมาย")

      const wrong = await assignOrderItemTherapist(makeFormData({ id: item.id, therapistId: t2.id }))
      expect(wrong.ok).toBe(false)

      const assigned = await assignOrderItemTherapist(makeFormData({ id: item.id, therapistId: t1.id }))
      expect(assigned.ok).toBe(true)
      expect((await db.mobileOrderItem.findUniqueOrThrow({ where: { id: item.id } })).therapistId).toBe(t1.id)
      expect((await startServiceItem(makeFormData({ id: item.id }))).ok).toBe(true)

      // KDS "เริ่มทำ" ใช้กับโปรแกรมนวดไม่ได้ผลเพราะสถานะไม่ใช่ AWAITING_KITCHEN แล้ว — และเมื่อเสร็จแล้วเปลี่ยนพนักงานไม่ได้
      expect((await startCookingItem(makeFormData({ id: item.id }))).ok).toBe(false)
      await markItemServed(makeFormData({ id: item.id }))
      const late = await assignOrderItemTherapist(makeFormData({ id: item.id, therapistId: t1.id }))
      expect(late.ok).toBe(false)
    })

    it("ปิดบิลแล้ว SaleItem เก็บ therapistId และประวัติ/ใบเสร็จเห็นชื่อพนักงาน", async () => {
      const { program, food, t1, room } = await seedSpa()
      await createStaffTableOrder(orderForm(room.id, [{ menuItemId: program.id, therapistId: t1.id }, { menuItemId: food.id }]))
      const session = await testPrisma().tableSession.findFirstOrThrow({ where: { tableId: room.id } })

      const closed = await closeSessionWithPayment({ storeId: TEST_STORE_ID, sessionId: session.id, paymentMethod: "CASH", cashierId: "owner", amountReceived: 340 })
      expect(closed.ok).toBe(true)

      const saleItems = await testPrisma().saleItem.findMany({ orderBy: { name: "asc" } })
      expect(saleItems.map((i) => [i.name, i.therapistId])).toEqual([
        ["นวดไทย 60", t1.id],
        ["น้ำขิง", null],
      ])
      const [sale] = await queries.listSales(TEST_STORE_ID, {})
      expect(sale.items.find((i) => i.name === "นวดไทย 60")?.therapistLabel).toBe("001 นิด")
      expect((await queries.listTherapists(TEST_STORE_ID)).find((t) => t.code === "001")?.servedCount).toBe(1)
    })
  })
})
