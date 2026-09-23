/// วันทางธุรกิจของร้าน — ยึดเวลาไทย (Asia/Bangkok) ไม่ใช่ TZ ของเครื่อง
/// เพราะ container บน VPS รันด้วย UTC ถ้าใช้เวลาเครื่องตรง ๆ "วันนี้" จะหมุนตอน 07:00 น. ตามเวลาไทย
/// แล้วกติกา void บิลวันเดียวกัน/ปิดยอดประจำวันจะเพี้ยนทันที
const TZ_OFFSET_MINUTES = 7 * 60

function shifted(date: Date): Date {
  return new Date(date.getTime() + TZ_OFFSET_MINUTES * 60_000)
}

/// คีย์ของวันทางธุรกิจในรูปแบบ YYYY-MM-DD (เวลาไทย)
export function businessDayKey(date: Date = new Date()): string {
  return shifted(date).toISOString().slice(0, 10)
}

/// ช่วงเวลาจริง (UTC) ของวันทางธุรกิจที่ครอบ `date` — ใช้กับ where createdAt: { gte, lt }
export function businessDayRange(date: Date = new Date()): { start: Date; end: Date } {
  const s = shifted(date)
  const startUtcMs = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())
  const start = new Date(startUtcMs - TZ_OFFSET_MINUTES * 60_000)
  const end = new Date(start.getTime() + 24 * 60 * 60_000)
  return { start, end }
}

/// ค่าสำหรับคอลัมน์ชนิด DATE (`@db.Date`) — เที่ยงคืน UTC ของวันทางธุรกิจนั้น
export function businessDateOnly(date: Date = new Date()): Date {
  return new Date(`${businessDayKey(date)}T00:00:00.000Z`)
}

export function isSameBusinessDay(a: Date, b: Date): boolean {
  return businessDayKey(a) === businessDayKey(b)
}

/// แปลงคีย์ `YYYY-MM-DD` (จาก `<input type="date">` / `?date=`) กลับเป็นเวลาที่อยู่ "กลางวัน" ของวันทางธุรกิจนั้น
/// คืน null ถ้ารูปแบบผิด · วันที่ไม่มีจริง (เช่น 2026-02-30) · หรือเป็นวันอนาคต (ปิดรอบล่วงหน้าไม่ได้)
/// ใช้เที่ยงวันตามเวลาไทยแทนเที่ยงคืน เพื่อให้ businessDayRange()/businessDateOnly() ตีความตรงวันแน่นอน
export function parseBusinessDayKey(key: string, now: Date = new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const date = new Date(`${key}T12:00:00.000+07:00`)
  if (Number.isNaN(date.getTime())) return null
  if (businessDayKey(date) !== key) return null
  if (key > businessDayKey(now)) return null
  return date
}

// ───────────────────── การจอง/กะ (Phase 20b) ─────────────────────
// เวลาของคิวนวดถูกกรอกเป็น "วัน + เวลานาฬิกา" ซึ่งเป็นเวลาไทยเสมอ แต่เก็บลงฐานเป็น UTC
// จึงต้องมีจุดแปลงที่เดียวเหมือน businessDayRange() ไม่ให้แต่ละหน้าคำนวณ offset เอง

/// แปลงคีย์ `YYYY-MM-DD` เป็นเวลากลางวันของวันนั้น (เวลาไทย) — ต่างจาก parseBusinessDayKey ตรงที่ **ยอมให้เป็นวันอนาคต**
/// เพราะการจองล่วงหน้าเป็นเรื่องของวันข้างหน้าโดยธรรมชาติ · คืน null เมื่อรูปแบบผิดหรือวันที่ไม่มีจริง
export function parseDayKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const date = new Date(`${key}T12:00:00.000+07:00`)
  if (Number.isNaN(date.getTime())) return null
  if (businessDayKey(date) !== key) return null
  return date
}

/// เวลาจริง (UTC) ของ "วันทางธุรกิจ + นาทีนับจากเที่ยงคืน" ตามเวลาไทย — 2026-09-23 + 510 = 08:30 น. ของวันนั้น
export function businessDayTime(dayKey: string, minuteOfDay: number): Date {
  return new Date(new Date(`${dayKey}T00:00:00.000+07:00`).getTime() + minuteOfDay * 60_000)
}

/// นาทีนับจากเที่ยงคืน (เวลาไทย) ของเวลาที่ให้มา — ใช้วางตำแหน่งบล็อกบนตารางเวลา
export function minuteOfBusinessDay(date: Date): number {
  const s = shifted(date)
  return s.getUTCHours() * 60 + s.getUTCMinutes()
}

/// "HH:MM" → นาที · คืน null เมื่อรูปแบบผิดหรือเกินขอบเขตของวัน
export function parseHhMm(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/// นาที → "HH:MM" (เกิน 24 ชม. ถูกตัดกลับเข้าในวันเดียวกัน — ตารางเวลาไม่ข้ามเที่ยงคืน)
export function formatHhMm(minute: number): string {
  const safe = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`
}

/// เลื่อนคีย์วันไป `days` วัน (บวก/ลบ) — ใช้กับตารางกะรายสัปดาห์
export function addDays(dayKey: string, days: number): string {
  return new Date(new Date(`${dayKey}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/// วันจันทร์ของสัปดาห์ที่คีย์นี้อยู่ — ร้านนวดตั้งกะกันเป็นสัปดาห์ เริ่มวันจันทร์
export function weekStartKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  const weekday = (date.getUTCDay() + 6) % 7
  return addDays(dayKey, -weekday)
}

/// ค่าที่ใช้กับคอลัมน์ชนิด DATE จากคีย์วัน (TherapistShift.workDate)
export function dateOnlyFromKey(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`)
}
