import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  addTestMember,
  createTestCategory,
  createTestProduct,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง สลับผู้ใช้/ร้านด้วย setTestUser()/setActiveTestStore()
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("ระบบสิทธิ์ตามบทบาท (§4) — บทบาทเป็นของร้าน (Phase 13)", () => {
  let createProduct: (formData: FormData) => Promise<ActionResult>
  let deleteProduct: (formData: FormData) => Promise<ActionResult>
  let stockIn: (formData: FormData) => Promise<ActionResult>
  let assignUserRole: (formData: FormData) => Promise<ActionResult>
  let updateRole: (formData: FormData) => Promise<ActionResult>
  let deleteRole: (formData: FormData) => Promise<ActionResult>
  let permissions: typeof import("@/lib/permissions")

  beforeAll(async () => {
    const products = await import("@/app/actions/products")
    const stock = await import("@/app/actions/stock")
    const roles = await import("@/app/actions/roles")
    permissions = await import("@/lib/permissions")
    createProduct = products.createProduct
    deleteProduct = products.deleteProduct
    stockIn = stock.stockIn
    assignUserRole = roles.assignUserRole
    updateRole = roles.updateRole
    deleteRole = roles.deleteRole
  })

  beforeEach(async () => {
    await resetDb()
    // ไฟล์นี้ทดสอบระบบสิทธิ์เอง จึงเริ่มจาก STAFF ที่ "ไม่มีบทบาท" แล้วค่อยผูกทีละเคส
    // (OWNER ได้เต็มทุก resource อัตโนมัติ — ใช้ทดสอบ matrix ไม่ได้)
    await ensureTestUser("test-user", "ผู้ทดสอบ", { role: "STAFF" })
    setTestUser("test-user")
    setActiveTestStore(null)
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// สร้างบทบาทพร้อมสิทธิ์ในร้านทดสอบ แล้วผูกกับสมาชิกร้าน (StoreMember.roleId — ไม่ใช่ตาราง user อีกแล้ว)
  async function giveRole(
    name: string,
    grants: Partial<Record<string, string[]>>,
    options: { isSystem?: boolean; userId?: string; storeId?: string } = {},
  ) {
    const db = testPrisma()
    const storeId = options.storeId ?? TEST_STORE_ID
    const role = await db.role.create({
      data: {
        storeId,
        name,
        isSystem: options.isSystem ?? false,
        permissions: {
          create: Object.entries(grants).map(([resource, actions]) => ({
            resource: resource as never,
            actions: (actions ?? []) as never,
          })),
        },
      },
      select: { id: true },
    })
    await db.storeMember.update({
      where: { userId_storeId: { userId: options.userId ?? "test-user", storeId } },
      data: { roleId: role.id },
    })
    return role.id
  }

  const productForm = (categoryId: string, name = "สินค้าใหม่") =>
    makeFormData({ name, sku: "", categoryId, unit: "ชิ้น", price: "10", reorderPoint: "0" })

  describe("ด่านชั้นที่ 2 — Server Action", () => {
    it("STAFF ที่ไม่มีบทบาทเลย = ทำอะไรกับข้อมูลไม่ได้", async () => {
      const category = await createTestCategory()
      const result = await createProduct(productForm(category.id))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("ไม่มีสิทธิ์")
      expect(await testPrisma().product.count()).toBe(0)
    })

    it("OWNER ได้ทุกสิทธิ์โดยไม่ต้องมีบทบาท (Phase 13)", async () => {
      await addTestMember("test-user", TEST_STORE_ID, "OWNER")
      const category = await createTestCategory()

      const result = await createProduct(productForm(category.id))
      expect(result.ok).toBe(true)

      const current = await permissions.getCurrentPermissions()
      expect(current?.roleId).toBeNull()
      expect(await permissions.hasPermission("USERS", "DELETE")).toBe(true)
    })

    it("มี VIEW แต่ไม่มี ADD ก็ยังสร้างไม่ได้", async () => {
      await giveRole("ผู้ดูอย่างเดียว", { PRODUCTS: ["VIEW"] })
      const category = await createTestCategory()

      const result = await createProduct(productForm(category.id))
      expect(result.ok).toBe(false)
      expect(await testPrisma().product.count()).toBe(0)
    })

    it("มี ADD แล้วสร้างได้ แต่ยังลบไม่ได้ถ้าไม่มี DELETE", async () => {
      await giveRole("เพิ่มได้อย่างเดียว", { PRODUCTS: ["VIEW", "ADD"] })
      const category = await createTestCategory()

      const created = await createProduct(productForm(category.id))
      expect(created.ok).toBe(true)

      const product = await testPrisma().product.findFirstOrThrow()
      const removed = await deleteProduct(makeFormData({ id: product.id }))
      expect(removed.ok).toBe(false)
      expect(await testPrisma().product.count()).toBe(1)
    })

    it("สิทธิ์แยกตาม resource — มี STOCK_IN ไม่ได้แปลว่าแตะสินค้าได้", async () => {
      await giveRole("พนักงานคลัง", { STOCK_IN: ["VIEW", "ADD"] })
      const product = await createTestProduct({ quantity: 0 })

      const received = await stockIn(makeFormData({ productId: product.id, quantity: "5" }))
      expect(received.ok).toBe(true)

      const category = await createTestCategory("หมวดอื่น")
      const blocked = await createProduct(productForm(category.id, "ของใหม่"))
      expect(blocked.ok).toBe(false)
    })

    it("บทบาทผูกกับร้าน — สิทธิ์เต็มในร้าน A ไม่ติดตัวไปร้าน B", async () => {
      await giveRole("ผู้จัดการร้าน A", { PRODUCTS: ["VIEW", "ADD"] })
      // เป็น STAFF ไร้บทบาทในร้าน B
      await ensureTestStore({ id: OTHER_STORE_ID })
      await addTestMember("test-user", OTHER_STORE_ID, "STAFF")

      setActiveTestStore(OTHER_STORE_ID)
      const categoryB = await createTestCategory("หมวด B", OTHER_STORE_ID)
      const blocked = await createProduct(productForm(categoryB.id))
      expect(blocked.ok).toBe(false)
      if (!blocked.ok) expect(blocked.error).toContain("ไม่มีสิทธิ์")

      setActiveTestStore(TEST_STORE_ID)
      const categoryA = await createTestCategory("หมวด A")
      const allowed = await createProduct(productForm(categoryA.id))
      expect(allowed.ok).toBe(true)
    })

    it("ยังไม่ล็อกอิน ต้องได้ข้อความให้เข้าสู่ระบบ ไม่ใช่ข้อความสิทธิ์", async () => {
      setTestUser(null)
      const category = await createTestCategory()
      const result = await createProduct(productForm(category.id, "x"))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("เข้าสู่ระบบ")
    })
  })

  describe("guardAction / hasPermission", () => {
    it("อ่านสิทธิ์จาก DB สดทุกคำขอ — actions ว่างถือว่าไม่มีสิทธิ์", async () => {
      await giveRole("ไม่มีสิทธิ์เลย", { PRODUCTS: [], REPORTS: ["VIEW"] })

      expect(await permissions.hasPermission("PRODUCTS", "VIEW")).toBe(false)
      expect(await permissions.hasPermission("REPORTS", "VIEW")).toBe(true)

      const guard = await permissions.guardAction("PRODUCTS", "ADD")
      expect(guard.ok).toBe(false)
    })

    it("RESOURCE_ACTIONS ตรงกับตารางใน §4 — ledger ไม่มี EDIT/DELETE", () => {
      expect(permissions.RESOURCE_ACTIONS.STOCK_IN).toEqual(["VIEW", "ADD"])
      expect(permissions.RESOURCE_ACTIONS.STOCK_OUT).toEqual(["VIEW", "ADD"])
      expect(permissions.RESOURCE_ACTIONS.DASHBOARD).toEqual(["VIEW"])
      expect(permissions.RESOURCE_ACTIONS.REPORTS).toEqual(["VIEW"])
      expect(permissions.RESOURCE_ACTIONS.POS_HISTORY).toEqual(["VIEW", "DELETE"])
    })
  })

  describe("จัดการบทบาท", () => {
    it("ต้องมี USERS:EDIT ถึงจะแก้บทบาทได้", async () => {
      const roleId = await giveRole("ดูผู้ใช้ได้อย่างเดียว", { USERS: ["VIEW"] })

      const result = await updateRole(
        makeFormData({ id: roleId, name: "ชื่อใหม่", permissions: JSON.stringify([]) }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("ไม่มีสิทธิ์")
    })

    it("action ที่ resource ไม่รองรับถูกตัดทิ้งแม้ยิงตรงมา", async () => {
      const db = testPrisma()
      await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })
      const target = await db.role.create({
        data: { storeId: TEST_STORE_ID, name: "บทบาททดสอบ" },
        select: { id: true },
      })

      const result = await updateRole(
        makeFormData({
          id: target.id,
          name: "บทบาททดสอบ",
          // STOCK_IN ไม่รองรับ EDIT/DELETE — ต้องเหลือแค่ VIEW/ADD
          permissions: JSON.stringify([{ resource: "STOCK_IN", actions: ["VIEW", "ADD", "EDIT", "DELETE"] }]),
        }),
      )
      expect(result.ok).toBe(true)

      const saved = await db.rolePermission.findFirstOrThrow({ where: { roleId: target.id } })
      expect(saved.actions).toEqual(["VIEW", "ADD"])
    })

    it("แก้/ลบบทบาทของร้านอื่นไม่ได้ — ตอบไม่พบ ไม่ใช่สำเร็จ", async () => {
      const db = testPrisma()
      await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })
      await ensureTestStore({ id: OTHER_STORE_ID })
      const foreign = await db.role.create({
        data: { storeId: OTHER_STORE_ID, name: "บทบาทของร้าน B" },
        select: { id: true },
      })

      const renamed = await updateRole(
        makeFormData({ id: foreign.id, name: "ถูกร้าน A แก้", permissions: JSON.stringify([]) }),
      )
      expect(renamed.ok).toBe(false)
      if (!renamed.ok) expect(renamed.error).toContain("ไม่พบ")

      const removed = await deleteRole(makeFormData({ id: foreign.id }))
      expect(removed.ok).toBe(false)

      const untouched = await db.role.findUniqueOrThrow({ where: { id: foreign.id } })
      expect(untouched.name).toBe("บทบาทของร้าน B")
    })

    it("บทบาทระบบเปลี่ยนชื่อไม่ได้ และลบไม่ได้", async () => {
      const db = testPrisma()
      await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })
      // provisionStore() สร้าง "ผู้ดูแลระบบ" (isSystem) ให้ร้านทดสอบไว้แล้ว
      const system = await db.role.findFirstOrThrow({
        where: { storeId: TEST_STORE_ID, isSystem: true },
        select: { id: true },
      })

      const renamed = await updateRole(
        makeFormData({
          id: system.id,
          name: "ชื่อใหม่",
          permissions: JSON.stringify([{ resource: "USERS", actions: ["VIEW", "EDIT"] }]),
        }),
      )
      expect(renamed.ok).toBe(false)

      const removed = await deleteRole(makeFormData({ id: system.id }))
      expect(removed.ok).toBe(false)
      expect(await db.role.count({ where: { id: system.id } })).toBe(1)
    })

    it("บทบาทระบบต้องเหลือสิทธิ์ USERS:EDIT เสมอ — ตัดออกไม่ได้", async () => {
      const db = testPrisma()
      await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })
      const system = await db.role.create({
        data: { storeId: TEST_STORE_ID, name: "บทบาทระบบ", isSystem: true },
        select: { id: true },
      })

      const result = await updateRole(
        makeFormData({
          id: system.id,
          name: "บทบาทระบบ",
          permissions: JSON.stringify([{ resource: "USERS", actions: ["VIEW"] }]),
        }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("จัดการสิทธิ์")
    })

    it("ลบบทบาทที่ยังมีพนักงานสังกัดอยู่ไม่ได้", async () => {
      const db = testPrisma()
      const roleId = await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })

      const result = await deleteRole(makeFormData({ id: roleId }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("ยังมีพนักงาน")
      expect(await db.role.count({ where: { id: roleId } })).toBe(1)
    })
  })

  describe("กำหนดบทบาทให้พนักงานในร้าน", () => {
    it("กำหนดและถอดบทบาทได้ — เขียนที่ StoreMember ไม่ใช่ตาราง user", async () => {
      const db = testPrisma()
      const roleId = await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })
      await ensureTestUser("staff-2", "พนักงานสอง", { role: "STAFF" })

      const assigned = await assignUserRole(makeFormData({ userId: "staff-2", roleId }))
      expect(assigned.ok).toBe(true)
      const member = await db.storeMember.findUniqueOrThrow({
        where: { userId_storeId: { userId: "staff-2", storeId: TEST_STORE_ID } },
      })
      expect(member.roleId).toBe(roleId)

      const removed = await assignUserRole(makeFormData({ userId: "staff-2", roleId: "" }))
      expect(removed.ok).toBe(true)
      const after = await db.storeMember.findUniqueOrThrow({ where: { id: member.id } })
      expect(after.roleId).toBeNull()
    })

    it("กำหนดบทบาทให้คนที่ไม่ได้อยู่ในร้านนี้ไม่ได้ — แม้เป็นสมาชิกของร้านอื่น", async () => {
      const roleId = await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })
      await ensureTestStore({ id: OTHER_STORE_ID })
      await ensureTestUser("outsider", "คนร้านอื่น", { storeId: OTHER_STORE_ID, role: "STAFF" })

      const result = await assignUserRole(makeFormData({ userId: "outsider", roleId }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("ไม่พบพนักงาน")
    })

    it("กำหนดบทบาทของร้านอื่นให้พนักงานในร้านนี้ไม่ได้", async () => {
      await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })
      await ensureTestStore({ id: OTHER_STORE_ID })
      const foreignRole = await testPrisma().role.create({
        data: { storeId: OTHER_STORE_ID, name: "บทบาทของร้าน B" },
        select: { id: true },
      })

      const result = await assignUserRole(makeFormData({ userId: "test-user", roleId: foreignRole.id }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("ไม่พบบทบาท")
    })

    it("กำหนดบทบาทที่ไม่มีอยู่จริงไม่ได้", async () => {
      await giveRole("ผู้ดูแล", { USERS: ["VIEW", "EDIT"] })
      const result = await assignUserRole(makeFormData({ userId: "test-user", roleId: "ไม่มีอยู่จริง" }))
      expect(result.ok).toBe(false)
    })
  })
})
