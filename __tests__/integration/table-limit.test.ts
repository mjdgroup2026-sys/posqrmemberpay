import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { DAY_MS } from "@/lib/subscription"
import { createTestTable, disconnectTestDb, ensureTestStore, ensureTestUser, isTestDbReachable, resetDb, TEST_STORE_ID, testPrisma } from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const dbReady = await isTestDbReachable()

/// เพดานโต๊ะตาม tier (Phase 14b) — กติกาข้อ 4: นับใต้ advisory lock ต่อร้าน กันสร้างพร้อมกันทะลุเพดาน
describe.skipIf(!dbReady)("เพดานโต๊ะตามแพ็กเกจ (Phase 14b — table limit)", () => {
  let tables: typeof import("@/app/actions/tables")

  beforeAll(async () => {
    tables = await import("@/app/actions/tables")
  })

  beforeEach(async () => {
    await resetDb()
    // tier S = 12 โต๊ะ ยังไม่หมดอายุ
    await ensureTestStore({ plan: { tier: "S", tableLimit: 12, expiresAt: new Date(Date.now() + 30 * DAY_MS) } })
    await ensureTestUser("owner", "เจ้าของร้าน", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  const count = () => testPrisma().table.count({ where: { storeId: TEST_STORE_ID } })

  it("มี 12 โต๊ะแล้ว → createTable ตอบ ok:false พร้อมบอกเพดานและทางอัปเกรด", async () => {
    for (let i = 1; i <= 12; i += 1) await createTestTable(`T${i}`)
    const result = await tables.createTable(makeFormData({ code: "T13" }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("12 โต๊ะ")
      expect(result.error).toContain("ค่าใช้งาน")
    }
    expect(await count()).toBe(12)
  })

  it("★ ยิง createTable พร้อมกัน 5 คำขอตอนมี 10 โต๊ะ → ผ่านแค่ 2 และรวมไม่เกิน 12", async () => {
    for (let i = 1; i <= 10; i += 1) await createTestTable(`T${i}`)
    const results = await Promise.all(["A", "B", "C", "D", "E"].map((code) => tables.createTable(makeFormData({ code }))))
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(await count()).toBe(12)
  })

  it("createTablesBulk เกินเพดาน → ok:false ไม่สร้างสักตัว · พอดีเพดานสร้างได้", async () => {
    for (let i = 1; i <= 8; i += 1) await createTestTable(`T${i}`)
    const tooMany = await tables.createTablesBulk(makeFormData({ prefix: "B", from: 1, to: 5 }))
    expect(tooMany.ok).toBe(false)
    expect(await count()).toBe(8)
    const exact = await tables.createTablesBulk(makeFormData({ prefix: "B", from: 1, to: 4 }))
    expect(exact.ok, JSON.stringify(exact)).toBe(true)
    expect(await count()).toBe(12)
  })

  it("รวมโต๊ะ (merge) ไม่นับเป็นสร้าง — ทำได้แม้เต็มเพดาน · ลบ 1 แล้วสร้างใหม่ได้", async () => {
    const created = []
    for (let i = 1; i <= 12; i += 1) created.push(await createTestTable(`T${i}`))
    // เปิดโต๊ะหลักก่อนรวม (mergeTables ต้องการ session ของโต๊ะหลัก)
    const opened = await tables.openTableSession(makeFormData({ tableId: created[0].id }))
    expect(opened.ok, JSON.stringify(opened)).toBe(true)
    const merged = await tables.mergeTables(makeFormData({ primaryTableId: created[0].id, secondaryTableId: created[1].id }))
    expect(merged.ok, JSON.stringify(merged)).toBe(true)
    expect(await count()).toBe(12)

    expect((await tables.deleteTable(makeFormData({ id: created[11].id }))).ok).toBe(true)
    expect((await tables.createTable(makeFormData({ code: "NEW" }))).ok).toBe(true)
    expect(await count()).toBe(12)
  })

  it("ผู้ดูแลตั้งเพดานพิเศษสูงกว่า tier → สร้างได้ตามเพดานใหม่", async () => {
    await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { tableLimit: 14 } })
    for (let i = 1; i <= 12; i += 1) await createTestTable(`T${i}`)
    expect((await tables.createTable(makeFormData({ code: "T13" }))).ok).toBe(true)
    expect((await tables.createTable(makeFormData({ code: "T14" }))).ok).toBe(true)
    expect((await tables.createTable(makeFormData({ code: "T15" }))).ok).toBe(false)
  })
})
