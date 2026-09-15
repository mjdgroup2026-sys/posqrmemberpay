import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  createTestCategory,
  createTestProduct,
  disconnectTestDb,
  isTestDbReachable,
  ensureTestUser,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
/// session mock กลาง (Phase 13) — อ่าน StoreMember จากฐานเทสจริง จึงได้ requireStore()/requireOwner() ตามร้านที่ผู้ใช้อยู่
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

describe.skipIf(!dbReady)("หมวดหมู่สินค้า (F8) — ยิงลง PostgreSQL จริง", () => {
  let createCategory: (formData: FormData) => Promise<ActionResult>
  let updateCategory: (formData: FormData) => Promise<ActionResult>
  let deleteCategory: (formData: FormData) => Promise<ActionResult>

  beforeAll(async () => {
    const actions = await import("@/app/actions/categories")
    createCategory = actions.createCategory
    updateCategory = actions.updateCategory
    deleteCategory = actions.deleteCategory
  })

  beforeEach(async () => {
    await resetDb()
    // ด่านสิทธิ์ (§4) อ่านบทบาทจากแถวผู้ใช้จริง — session ที่ mock ไว้อย่างเดียวไม่พออีกต่อไป
    await ensureTestUser()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  it("สร้างหมวดหมู่ใหม่ได้และชื่อถูกตัดช่องว่างหัวท้าย", async () => {
    // act
    const result = await createCategory(makeFormData({ name: "  เครื่องดื่ม  " }))

    // assert
    expect(result.ok).toBe(true)
    const rows = await testPrisma().category.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("เครื่องดื่ม")
  })

  it("ชื่อหมวดหมู่ซ้ำต้องถูกปฏิเสธพร้อมข้อความภาษาไทย", async () => {
    // arrange
    await createTestCategory("เครื่องดื่ม")

    // act
    const result = await createCategory(makeFormData({ name: "เครื่องดื่ม" }))

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.fieldErrors?.name).toBe("ชื่อหมวดหมู่นี้ซ้ำกับที่มีอยู่")
    expect(await testPrisma().category.count()).toBe(1)
  })

  it("แก้ชื่อหมวดหมู่ให้ซ้ำกับหมวดอื่นต้องถูกปฏิเสธ", async () => {
    // arrange
    const first = await createTestCategory("ของสด")
    await createTestCategory("ของแห้ง")

    // act
    const result = await updateCategory(makeFormData({ id: first.id, name: "ของแห้ง" }))

    // assert
    expect(result.ok).toBe(false)
    const unchanged = await testPrisma().category.findUniqueOrThrow({ where: { id: first.id } })
    expect(unchanged.name).toBe("ของสด")
  })

  it("ลบหมวดหมู่ที่ยังมีสินค้าผูกอยู่ไม่ได้ และต้องบอกจำนวนสินค้า", async () => {
    // arrange
    await createTestProduct({ category: "ของสด", name: "ปลาทู" })
    await createTestProduct({ category: "ของสด", name: "หมูสามชั้น" })
    const category = await testPrisma().category.findFirstOrThrow({ where: { storeId: TEST_STORE_ID, name: "ของสด" } })

    // act
    const result = await deleteCategory(makeFormData({ id: category.id }))

    // assert
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain("2 รายการ")
    expect(await testPrisma().category.count()).toBe(1)
  })

  it("ลบหมวดหมู่ที่ไม่มีสินค้าผูกอยู่ได้", async () => {
    // arrange
    const category = await createTestCategory("หมวดว่าง")

    // act
    const result = await deleteCategory(makeFormData({ id: category.id }))

    // assert
    expect(result.ok).toBe(true)
    expect(await testPrisma().category.count()).toBe(0)
  })
})
