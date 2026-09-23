import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import { addDays, businessDayKey } from "@/lib/day"
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

/// กะทำงานของพนักงานนวด (Phase 20b) — เก็บรายวัน · คัดลอกทั้งสัปดาห์ได้ · แยก "หยุด" ออกจาก "ยังไม่ตั้งกะ"
describe.skipIf(!dbReady)("ร้านนวด — กะพนักงาน (Phase 20b)", () => {
  let saveShift: (formData: FormData) => Promise<ActionResult>
  let deleteShift: (formData: FormData) => Promise<ActionResult>
  let copyShifts: (formData: FormData) => Promise<ActionResult>
  let queries: typeof import("@/lib/queries")

  const today = businessDayKey()

  beforeAll(async () => {
    const shifts = await import("@/app/actions/therapist-shifts")
    saveShift = shifts.saveShift
    deleteShift = shifts.deleteShift
    copyShifts = shifts.copyShifts
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner", "เจ้าของ", { storeId: TEST_STORE_ID, role: "OWNER" })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    await setStoreSettings({})
    await testPrisma().storeSettings.update({ where: { storeId: TEST_STORE_ID }, data: { spaEnabled: true } })
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function seedTherapists() {
    const db = testPrisma()
    const t1 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "001", name: "นิด" } })
    const t2 = await db.therapist.create({ data: { storeId: TEST_STORE_ID, code: "002", name: "หน่อย" } })
    return { t1, t2 }
  }

  it("ตั้งกะ · แก้เวลา · ทำเครื่องหมายวันหยุด · ล้างกะกลับเป็นยังไม่ตั้ง", async () => {
    const { t1 } = await seedTherapists()

    expect((await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "09:00", endTime: "20:00", isOff: "false" }))).ok).toBe(true)
    let rows = await queries.listTherapistShifts(TEST_STORE_ID, today, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0].startMinute).toBe(540)
    expect(rows[0].endMinute).toBe(1200)
    expect(rows[0].workDate).toBe(today)

    // แก้ทับวันเดิม — ยังต้องเหลือแถวเดียว (unique therapistId + workDate)
    expect((await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "10:30", endTime: "19:00", isOff: "false" }))).ok).toBe(true)
    rows = await queries.listTherapistShifts(TEST_STORE_ID, today, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0].startMinute).toBe(630)

    expect((await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "10:30", endTime: "19:00", isOff: "true" }))).ok).toBe(true)
    expect((await queries.listTherapistShifts(TEST_STORE_ID, today, 1))[0].isOff).toBe(true)

    expect((await deleteShift(makeFormData({ therapistId: t1.id, workDate: today }))).ok).toBe(true)
    expect(await queries.listTherapistShifts(TEST_STORE_ID, today, 1)).toHaveLength(0)
  })

  it("เวลาออกงานก่อนเวลาเข้างานถูกปฏิเสธ · พนักงานของร้านอื่นไม่มีในร้านนี้", async () => {
    const { t1 } = await seedTherapists()

    const backwards = await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "20:00", endTime: "09:00", isOff: "false" }))
    expect(backwards.ok).toBe(false)
    expect(backwards.ok === false && backwards.fieldErrors?.endTime).toBeTruthy()

    const unknown = await saveShift(makeFormData({ therapistId: "no-such-therapist", workDate: today, startTime: "09:00", endTime: "18:00", isOff: "false" }))
    expect(unknown.ok).toBe(false)
  })

  it("คัดลอกกะของวันหนึ่งไปทั้งสัปดาห์ — เขียนทับวันปลายทางทั้งวัน", async () => {
    const { t1, t2 } = await seedTherapists()
    await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "09:00", endTime: "20:00", isOff: "false" }))
    await saveShift(makeFormData({ therapistId: t2.id, workDate: today, startTime: "12:00", endTime: "22:00", isOff: "true" }))

    // วันปลายทางวันหนึ่งมีของเดิมอยู่ก่อน — ต้องถูกแทนที่ ไม่ใช่รวมกัน
    const day1 = addDays(today, 1)
    await saveShift(makeFormData({ therapistId: t1.id, workDate: day1, startTime: "06:00", endTime: "07:00", isOff: "false" }))

    const targets = [1, 2, 3].map((offset) => addDays(today, offset))
    const copied = await copyShifts(makeFormData({ sourceDate: today, targetDates: targets.join(",") }))
    expect(copied.ok).toBe(true)

    for (const day of targets) {
      const rows = await queries.listTherapistShifts(TEST_STORE_ID, day, 1)
      expect(rows).toHaveLength(2)
      expect(rows.find((r) => r.therapistId === t1.id)?.startMinute).toBe(540)
      expect(rows.find((r) => r.therapistId === t2.id)?.isOff).toBe(true)
    }

    // ช่วง 7 วันจากวันต้นทางต้องเห็น 4 วัน × 2 คน
    expect(await queries.listTherapistShifts(TEST_STORE_ID, today, 7)).toHaveLength(8)
  })

  it("คัดลอกจากวันที่ยังไม่มีกะ หรือปลายทางเป็นวันเดียวกับต้นทาง ถูกปฏิเสธ", async () => {
    await seedTherapists()

    const empty = await copyShifts(makeFormData({ sourceDate: today, targetDates: addDays(today, 1) }))
    expect(empty.ok).toBe(false)

    const { t1 } = await seedShiftFor()
    expect(t1).toBeTruthy()
    const sameDay = await copyShifts(makeFormData({ sourceDate: today, targetDates: today }))
    expect(sameDay.ok).toBe(false)
  })

  async function seedShiftFor() {
    const t1 = await testPrisma().therapist.findFirstOrThrow({ where: { storeId: TEST_STORE_ID, code: "001" } })
    await saveShift(makeFormData({ therapistId: t1.id, workDate: today, startTime: "09:00", endTime: "20:00", isOff: "false" }))
    return { t1 }
  }
})
