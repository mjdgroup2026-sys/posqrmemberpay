import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createTestMenuItem,
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
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// ไบต์ PNG ที่ sniffImageType() ยอมรับ — เนื้อในไม่ต้องเป็นรูปจริง เทสนี้วัดเส้นทางเก็บ/เสิร์ฟ/ลบ
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22, 0x33])

function pngFile(name = "menu.png"): File {
  return new File([PNG_BYTES], name, { type: "image/png" })
}

/// รูปที่ร้านอัปโหลดเอง (Phase 17a) — เก็บไบต์ในฐาน เสิร์ฟผ่าน /api/assets/[id]
/// สิ่งที่ต้องจริงเสมอ: ไฟล์ที่ไม่ใช่รูปเข้าไม่ได้ · รูปเก่าถูกลบเมื่อถูกแทนที่ · ร้านหนึ่งลบรูปของอีกร้านไม่ได้
describe.skipIf(!dbReady)("รูปภาพที่ร้านอัปโหลด (Phase 17a)", () => {
  let assets: typeof import("@/app/actions/assets")
  let menu: typeof import("@/app/actions/menu")
  let serveAsset: typeof import("@/app/api/assets/[id]/route").GET

  beforeAll(async () => {
    assets = await import("@/app/actions/assets")
    menu = await import("@/app/actions/menu")
    serveAsset = (await import("@/app/api/assets/[id]/route")).GET
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้าน B" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  it("อัปโหลดแล้วได้ URL ภายในระบบ และเสิร์ฟกลับมาเป็นไบต์เดิม", async () => {
    const fd = new FormData()
    fd.set("file", pngFile())
    const result = await assets.uploadStoreAsset(fd)

    expect(result.ok).toBe(true)
    const url = result.ok ? result.data!.url : ""
    expect(url).toMatch(/^\/api\/assets\/[A-Za-z0-9_-]+$/)

    const id = url.split("/").pop()!
    const row = await testPrisma().storeAsset.findUniqueOrThrow({ where: { id } })
    expect(row.storeId).toBe(TEST_STORE_ID)
    expect(row.contentType).toBe("image/png")
    expect(row.byteSize).toBe(PNG_BYTES.byteLength)

    const response = await serveAsset(new Request(`http://localhost${url}`), {
      params: Promise.resolve({ id }),
    } as never)
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("image/png")
    expect(response.headers.get("Cache-Control")).toContain("immutable")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it("รูปที่ไม่มีอยู่ → 404 และไม่ให้แคช", async () => {
    const response = await serveAsset(new Request("http://localhost/api/assets/nope"), {
      params: Promise.resolve({ id: "nope" }),
    } as never)
    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("ไฟล์ที่ไม่ใช่รูป (SVG ที่แอบอ้างเป็น PNG) ถูกปฏิเสธ ไม่มีแถวในฐาน", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    const fd = new FormData()
    fd.set("file", new File([svg], "evil.png", { type: "image/png" }))

    const result = await assets.uploadStoreAsset(fd)

    expect(result.ok).toBe(false)
    expect(await testPrisma().storeAsset.count()).toBe(0)
  })

  it("ยังไม่ล็อกอิน → อัปโหลดไม่ได้", async () => {
    setTestUser(null)
    const fd = new FormData()
    fd.set("file", pngFile())

    const result = await assets.uploadStoreAsset(fd)

    expect(result.ok).toBe(false)
    expect(await testPrisma().storeAsset.count()).toBe(0)
  })

  it("เปลี่ยนรูปเมนู → รูปเก่าถูกลบในทรานแซคชันเดียวกัน เหลือเฉพาะรูปใหม่", async () => {
    const db = testPrisma()
    const first = await assets.uploadStoreAsset(formDataWithFile())
    const second = await assets.uploadStoreAsset(formDataWithFile())
    expect(first.ok && second.ok).toBe(true)
    const oldUrl = first.ok ? first.data!.url : ""
    const newUrl = second.ok ? second.data!.url : ""

    const item = await createTestMenuItem({ name: "ข้าวผัด" })
    await db.menuItem.update({ where: { id: item.id }, data: { imageUrl: oldUrl } })

    const saved = await menu.saveMenuItem(
      makeFormData({ id: item.id, name: "ข้าวผัด", price: "60", imageUrl: newUrl, isActive: "true" }),
    )

    expect(saved.ok).toBe(true)
    expect(await db.storeAsset.findUnique({ where: { id: oldUrl.split("/").pop()! } })).toBeNull()
    expect(await db.storeAsset.findUnique({ where: { id: newUrl.split("/").pop()! } })).not.toBeNull()
  })

  it("ลบเมนู → รูปของเมนูนั้นถูกลบตามไปด้วย", async () => {
    const db = testPrisma()
    const uploaded = await assets.uploadStoreAsset(formDataWithFile())
    const url = uploaded.ok ? uploaded.data!.url : ""
    const item = await createTestMenuItem({ name: "ต้มยำ" })
    await db.menuItem.update({ where: { id: item.id }, data: { imageUrl: url } })

    const deleted = await menu.deleteMenuItem(makeFormData({ id: item.id }))

    expect(deleted.ok).toBe(true)
    expect(await db.storeAsset.findUnique({ where: { id: url.split("/").pop()! } })).toBeNull()
  })

  it("ลบรูปของร้านอื่นไม่ได้ — แถวของร้าน B ต้องอยู่ครบ", async () => {
    const db = testPrisma()
    const other = await db.storeAsset.create({
      data: {
        storeId: OTHER_STORE_ID,
        contentType: "image/png",
        byteSize: PNG_BYTES.byteLength,
        data: Buffer.from(PNG_BYTES),
      },
      select: { id: true },
    })

    const result = await assets.deleteStoreAsset(makeFormData({ url: `/api/assets/${other.id}` }))

    expect(result.ok).toBe(false)
    expect(await db.storeAsset.findUnique({ where: { id: other.id } })).not.toBeNull()
  })
})

function formDataWithFile(): FormData {
  const fd = new FormData()
  fd.set("file", pngFile())
  return fd
}
