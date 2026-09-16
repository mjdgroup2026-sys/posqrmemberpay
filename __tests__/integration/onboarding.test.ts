import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { disconnectTestDb, ensureTestUser, isTestDbReachable, resetDb, testPrisma } from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

/// cookie ที่ action ตั้งให้หลังสร้างร้าน — จับไว้ตรวจว่าชี้ร้านใหม่จริง
const cookieSet = vi.fn()
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, set: cookieSet, delete: vi.fn() })),
}))

const dbReady = await isTestDbReachable()

/// Onboarding (Phase 14a) — ผู้ใช้ที่ล็อกอินสร้างร้านของตัวเองครบชุดในทรานแซคชันเดียว
describe.skipIf(!dbReady)("createStore — สร้างร้านใหม่ (Phase 14a onboarding)", () => {
  let createStore: typeof import("@/app/actions/onboarding").createStore

  beforeAll(async () => {
    ;({ createStore } = await import("@/app/actions/onboarding"))
  })

  beforeEach(async () => {
    await resetDb()
    cookieSet.mockClear()
    // ผู้ใช้ใหม่ที่เพิ่งยืนยันอีเมล — ยังไม่อยู่ในร้านใด
    await ensureTestUser("newbie", "คนสมัครใหม่", { storeId: null })
    setTestUser("newbie")
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  const validForm = () => makeFormData({ name: "ครัวคุณแม่", slug: "mom-kitchen", themeColor: "#E8571F" })

  it("สร้าง Store + Settings + บทบาทระบบ 4 + OWNER + โต๊ะ 4 + QR 4 + เมนู 3 ในครั้งเดียว และตั้ง cookie ชี้ร้านใหม่", async () => {
    const result = await createStore(validForm())
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return

    const db = testPrisma()
    const storeId = result.data?.storeId ?? ""
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId } })
    expect(store.slug).toBe("mom-kitchen")
    expect(store.name).toBe("ครัวคุณแม่")
    expect(store.status).toBe("ACTIVE")

    const settings = await db.storeSettings.findUniqueOrThrow({ where: { storeId } })
    expect(settings.storeName).toBe("ครัวคุณแม่")
    expect(settings.themeColor).toBe("#E8571F")

    expect(await db.role.count({ where: { storeId } })).toBe(4)

    const member = await db.storeMember.findUniqueOrThrow({ where: { userId_storeId: { userId: "newbie", storeId } } })
    expect(member.role).toBe("OWNER")

    const tables = await db.table.findMany({ where: { storeId }, orderBy: { code: "asc" } })
    expect(tables.map((t) => t.code)).toEqual(["T1", "T2", "T3", "T4"])
    expect(await db.qRCode.count({ where: { storeId, status: "ACTIVE", type: "STATIC" } })).toBe(4)

    const menu = await db.menuItem.findMany({ where: { storeId } })
    expect(menu).toHaveLength(3)
    expect(menu.every((m) => m.isFeatured && m.isActive)).toBe(true)

    // พาไปทำงานกับร้านใหม่ทันที
    expect(cookieSet).toHaveBeenCalledWith("activeStoreId", storeId, expect.objectContaining({ httpOnly: true }))
  })

  it("slug ซ้ำกับร้านที่มีอยู่ → ok:false และไม่มีร้านเพิ่ม", async () => {
    await createStore(validForm())
    const before = await testPrisma().store.count()

    const result = await createStore(makeFormData({ name: "ร้านอื่น", slug: "mom-kitchen", themeColor: "#123456" }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fieldErrors?.slug).toBeTruthy()
    expect(await testPrisma().store.count()).toBe(before)
  })

  it("slug ที่สงวนไว้ (default/admin/api/order) → ok:false", async () => {
    for (const slug of ["default", "admin", "api", "order"]) {
      const result = await createStore(makeFormData({ name: "ร้านลอง", slug, themeColor: "#E8571F" }))
      expect(result.ok, slug).toBe(false)
    }
    expect(await testPrisma().store.count()).toBe(0)
  })

  it("slug รูปแบบผิด / สีธีมไม่ใช่ hex / ชื่อสั้นเกิน → ok:false พร้อม fieldErrors", async () => {
    const bad = [
      { name: "ร้านลอง", slug: "Has Space", themeColor: "#E8571F", field: "slug" },
      { name: "ร้านลอง", slug: "ab", themeColor: "#E8571F", field: "slug" },
      { name: "ร้านลอง", slug: "ok-slug", themeColor: "red", field: "themeColor" },
      { name: "ก", slug: "ok-slug", themeColor: "#E8571F", field: "name" },
    ]
    for (const { field, ...form } of bad) {
      const result = await createStore(makeFormData(form))
      expect(result.ok, field).toBe(false)
      if (!result.ok) expect(result.fieldErrors?.[field], field).toBeTruthy()
    }
  })

  it("ผู้ใช้ที่มีร้านอยู่แล้วสร้างร้านที่ 2 ได้ และเป็น OWNER ทั้งสองร้าน (หลายสาขา)", async () => {
    const first = await createStore(validForm())
    const second = await createStore(makeFormData({ name: "ครัวคุณแม่ สาขา 2", slug: "mom-kitchen-2", themeColor: "#01787B" }))
    expect(first.ok && second.ok).toBe(true)

    const memberships = await testPrisma().storeMember.findMany({ where: { userId: "newbie" } })
    expect(memberships).toHaveLength(2)
    expect(memberships.every((m) => m.role === "OWNER")).toBe(true)
  })

  it("ยังไม่ล็อกอิน → ok:false ไม่มีร้านถูกสร้าง", async () => {
    setTestUser(null)
    const result = await createStore(validForm())
    expect(result.ok).toBe(false)
    expect(await testPrisma().store.count()).toBe(0)
  })

  it("ข้อมูลตัวอย่างของแต่ละร้านไม่ปนกัน — โต๊ะ T1 มีได้ทุกร้าน (unique ต่อร้าน)", async () => {
    await createStore(validForm())
    await ensureTestUser("other", "อีกคน", { storeId: null })
    setTestUser("other")
    const result = await createStore(makeFormData({ name: "ร้านของอีกคน", slug: "other-shop", themeColor: "#E8571F" }))
    expect(result.ok).toBe(true)
    expect(await testPrisma().table.count({ where: { code: "T1" } })).toBe(2)
  })
})
