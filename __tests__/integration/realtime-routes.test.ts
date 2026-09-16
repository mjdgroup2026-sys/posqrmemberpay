import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createTestQrCode,
  createTestTable,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  TEST_STORE_ID,
} from "../helpers/db"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read()
  return new TextDecoder().decode(value)
}

/// SSE route handlers (Phase 8 realtime): ฝั่งพนักงานต้องล็อกอิน+อยู่ในร้าน และได้เฉพาะ event ของร้านตัวเอง ·
/// ฝั่งลูกค้ายึด qrToken · action ที่แตะข้อมูลต้อง publish จริง
describe.skipIf(!dbReady)("SSE realtime routes", () => {
  let staffGet: typeof import("@/app/api/events/route").GET
  let customerGet: typeof import("@/app/api/order/[qrToken]/events/route").GET
  let realtime: typeof import("@/lib/realtime")
  let tables: typeof import("@/app/actions/tables")

  beforeAll(async () => {
    staffGet = (await import("@/app/api/events/route")).GET
    customerGet = (await import("@/app/api/order/[qrToken]/events/route")).GET
    realtime = await import("@/lib/realtime")
    tables = await import("@/app/actions/tables")
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

  it("ไม่ได้ล็อกอิน → 401 ไม่เปิด stream", async () => {
    setTestUser(null)
    const response = await staffGet(new Request("http://localhost/api/events") as never)
    expect(response.status).toBe(401)
    expect(realtime.listenerCount(TEST_STORE_ID)).toBe(0)
  })

  it("พนักงานร้าน A: ได้ ready แล้ว event ของร้าน A · event ของร้าน B ไม่มาถึง · ปิดแล้วผู้ฟังหาย", async () => {
    const controller = new AbortController()
    const response = await staffGet(new Request("http://localhost/api/events", { signal: controller.signal }) as never)
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    let text = await readChunk(reader)
    if (!text.includes("event: ready")) text += await readChunk(reader)
    expect(text).toContain("event: ready")
    expect(realtime.listenerCount(TEST_STORE_ID)).toBe(1)
    expect(realtime.listenerCount(OTHER_STORE_ID)).toBe(0)

    realtime.publishStoreEvent(OTHER_STORE_ID, "tables")
    realtime.publishStoreEvent(TEST_STORE_ID, "notifications")
    const change = await readChunk(reader)
    expect(change).toContain('"topic":"notifications"')

    controller.abort()
    await new Promise((r) => setTimeout(r, 0))
    expect(realtime.listenerCount(TEST_STORE_ID)).toBe(0)
  })

  it("action ที่แตะข้อมูล (เปิดโต๊ะ) publish ให้ร้านนั้นจริง", async () => {
    const received: string[] = []
    const off = realtime.subscribeStore(TEST_STORE_ID, (e) => received.push(e.topic))
    const table = await createTestTable("R1")
    const fd = new FormData()
    fd.set("tableId", table.id)
    expect((await tables.openTableSession(fd)).ok).toBe(true)
    off()
    expect(received).toContain("tables")
  })

  it("ฝั่งลูกค้า: qrToken ไม่รู้จัก → 404 · token ของร้าน A ได้ event ของ A (เฉพาะ topic ลูกค้า)", async () => {
    const bad = await customerGet(new Request("http://localhost/x") as never, { params: Promise.resolve({ qrToken: "nope" }) } as never)
    expect(bad.status).toBe(404)

    const table = await createTestTable("C1")
    const qr = await createTestQrCode(table.id, { type: "STATIC" })
    const controller = new AbortController()
    const response = await customerGet(new Request("http://localhost/x", { signal: controller.signal }) as never, {
      params: Promise.resolve({ qrToken: qr.token }),
    } as never)
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    let text = await readChunk(reader)
    if (!text.includes("event: ready")) text += await readChunk(reader)
    expect(text).toContain("event: ready")

    realtime.publishStoreEvent(TEST_STORE_ID, "menu") // ลูกค้าไม่ได้รับ topic นี้
    realtime.publishStoreEvent(TEST_STORE_ID, "payments")
    const change = await readChunk(reader)
    expect(change).toContain('"topic":"payments"')
    controller.abort()
  })
})
