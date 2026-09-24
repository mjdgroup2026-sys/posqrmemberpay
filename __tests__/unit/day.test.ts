import { describe, expect, it } from "vitest"
import { businessDayKey, businessDayRange, businessDateOnly, isSameBusinessDay, parseBusinessDayKey, resolveDayRange } from "@/lib/day"

/// วันทางธุรกิจยึดเวลาไทยเสมอ (UTC+7) ไม่ใช่ TZ ของเครื่องที่รัน —
/// container บน production รันด้วย UTC ถ้าใช้เวลาเครื่องตรง ๆ "วันนี้" จะหมุนตอน 07:00 น. ตามเวลาไทย
describe("lib/day — วันทางธุรกิจตามเวลาไทย", () => {
  it("เวลา 23:30 ของวันที่ 3 ตามเวลาไทย ต้องยังเป็นวันที่ 3", () => {
    // 2026-09-03 23:30 (+07:00) = 2026-09-03 16:30 UTC
    const date = new Date("2026-09-03T16:30:00.000Z")
    expect(businessDayKey(date)).toBe("2026-09-03")
  })

  it("เวลา 00:30 ของวันที่ 4 ตามเวลาไทย ต้องเป็นวันที่ 4 (ไม่ใช่วันที่ 3 ตาม UTC)", () => {
    // 2026-09-04 00:30 (+07:00) = 2026-09-03 17:30 UTC
    const date = new Date("2026-09-03T17:30:00.000Z")
    expect(businessDayKey(date)).toBe("2026-09-04")
  })

  it("ช่วงของวันต้องเริ่ม 17:00 UTC ของวันก่อนหน้า และยาว 24 ชั่วโมงพอดี", () => {
    const { start, end } = businessDayRange(new Date("2026-09-03T16:30:00.000Z"))
    expect(start.toISOString()).toBe("2026-09-02T17:00:00.000Z")
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it("ค่าที่ใช้กับคอลัมน์ DATE ต้องเป็นเที่ยงคืน UTC ของวันทางธุรกิจนั้น", () => {
    expect(businessDateOnly(new Date("2026-09-03T17:30:00.000Z")).toISOString()).toBe(
      "2026-09-04T00:00:00.000Z",
    )
  })

  it("บิลที่ขาย 23:59 กับเวลา 00:01 ของวันถัดไป (เวลาไทย) ต้องถือว่าคนละวัน", () => {
    const sold = new Date("2026-09-03T16:59:00.000Z") // 23:59 ไทย
    const now = new Date("2026-09-03T17:01:00.000Z") // 00:01 ไทย ของวันถัดไป
    expect(isSameBusinessDay(sold, now)).toBe(false)
  })

  it("บิลที่ขายเช้าและตอนดึกของวันเดียวกัน (เวลาไทย) ต้องถือว่าวันเดียวกัน", () => {
    const morning = new Date("2026-09-03T02:00:00.000Z") // 09:00 ไทย
    const night = new Date("2026-09-03T16:00:00.000Z") // 23:00 ไทย
    expect(isSameBusinessDay(morning, night)).toBe(true)
  })

  // ───────────────────── Phase 19 — คีย์วันจากตัวเลือกวันปิดรอบ ─────────────────────

  it("parseBusinessDayKey: คีย์ที่ถูกต้องคืนเวลาที่ตกในวันนั้นแน่นอน (ไม่ว่าคำนวณช่วง/คอลัมน์ DATE)", () => {
    const now = new Date("2026-09-22T05:00:00.000Z") // 12:00 ไทย
    const day = parseBusinessDayKey("2026-09-21", now)
    expect(day).not.toBeNull()
    if (!day) return
    expect(businessDayKey(day)).toBe("2026-09-21")
    expect(businessDateOnly(day).toISOString()).toBe("2026-09-21T00:00:00.000Z")
    const { start, end } = businessDayRange(day)
    expect(start.toISOString()).toBe("2026-09-20T17:00:00.000Z")
    expect(end.toISOString()).toBe("2026-09-21T17:00:00.000Z")
  })

  it("parseBusinessDayKey: วันนี้ผ่าน · พรุ่งนี้ (ตามเวลาไทย) ไม่ผ่าน แม้ UTC ยังเป็นวันเดิม", () => {
    const now = new Date("2026-09-22T16:30:00.000Z") // 23:30 ไทย วันที่ 22 — UTC ยังเป็นวันที่ 22 เช่นกัน
    expect(parseBusinessDayKey("2026-09-22", now)).not.toBeNull()
    expect(parseBusinessDayKey("2026-09-23", now)).toBeNull()
    const late = new Date("2026-09-22T17:30:00.000Z") // 00:30 ไทย วันที่ 23 — UTC ยังวันที่ 22
    expect(parseBusinessDayKey("2026-09-23", late)).not.toBeNull()
  })

  it("parseBusinessDayKey: รูปแบบผิด / วันที่ไม่มีจริง คืน null", () => {
    expect(parseBusinessDayKey("22/09/2026")).toBeNull()
    expect(parseBusinessDayKey("2026-9-2")).toBeNull()
    expect(parseBusinessDayKey("2026-02-30")).toBeNull()
    expect(parseBusinessDayKey("2026-13-01")).toBeNull()
    expect(parseBusinessDayKey("")).toBeNull()
  })

  it("resolveDayRange: ค่าว่าง/ผิด ถอยเป็น 30 วันล่าสุด · อนาคตถูกปัด · กรอกกลับหัวถูกสลับให้", () => {
    const now = new Date("2026-09-23T05:00:00.000Z") // 12:00 ไทย วันที่ 23
    expect(resolveDayRange(undefined, undefined, 30, now)).toEqual({ from: "2026-08-25", to: "2026-09-23" })
    expect(resolveDayRange("oops", "2026-09-10", 30, now)).toEqual({ from: "2026-08-12", to: "2026-09-10" })
    expect(resolveDayRange("2026-09-01", "2026-10-01", 30, now)).toEqual({ from: "2026-09-01", to: "2026-09-23" })
    expect(resolveDayRange("2026-09-20", "2026-09-05", 30, now)).toEqual({ from: "2026-09-05", to: "2026-09-20" })
    expect(resolveDayRange(["2026-09-01"], "2026-09-05", 7, now)).toEqual({ from: "2026-08-30", to: "2026-09-05" })
  })
})
