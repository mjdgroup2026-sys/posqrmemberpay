/// ค่าใช้งานแบบต่ออายุ (Phase 14b) — ฟังก์ชันคำนวณล้วน ไม่แตะ DB จึงเทสได้ตรง ๆ และใช้ซ้ำทั้ง action/หน้าจอ/seed
/// ⚠️ ไฟล์นี้ถูก import จาก Client Component (billing-panel) ด้วย — ห้ามใช้ node:crypto ที่นี่ (hash อยู่ lib/subscription-hash.ts)
///
/// หลักการ: ราคาสุทธิของแพ็กเกจ "ตั้งตรง ๆ" ในแถว SubscriptionPlan (ไม่คำนวณสด) — ไฟล์นี้จึงคำนวณแค่
/// ช่วงเวลา (stack ต่อท้าย), ส่วนต่างอัปเกรด, และ normalize เลขพร้อมเพย์สำหรับสิทธิ์ทดลอง

export const DAY_MS = 24 * 60 * 60 * 1000

/// หน่วยขั้นต่ำ 1 วัน = 10 บาท (tier S) — ใช้เป็นฐานของ CUSTOM และเป็นค่าอ้างอิงในตารางแพ็กเกจ
export const BASE_RATE_PER_DAY = 10

export type PlanTierValue = "S" | "M" | "L" | "XL"

/// เพดานโต๊ะและเรตต่อวันของแต่ละ tier — ค่าอ้างอิงสำหรับ seed/CUSTOM · ราคาจริงที่ขายอยู่อ่านจาก SubscriptionPlan
export const TIER_SPEC: Record<PlanTierValue, { tableLimit: number; ratePerDay: number; label: string }> = {
  S: { tableLimit: 12, ratePerDay: 10, label: "S · ไม่เกิน 12 โต๊ะ" },
  M: { tableLimit: 30, ratePerDay: 20, label: "M · ไม่เกิน 30 โต๊ะ" },
  L: { tableLimit: 60, ratePerDay: 35, label: "L · ไม่เกิน 60 โต๊ะ" },
  XL: { tableLimit: 120, ratePerDay: 60, label: "XL · ไม่เกิน 120 โต๊ะ" },
}

export const TIER_ORDER: PlanTierValue[] = ["S", "M", "L", "XL"]

/// ทดลองใช้ 7 วัน tier S — ครั้งเดียวต่อเลขพร้อมเพย์ตลอดกาล
export const TRIAL_DAYS = 7
export const TRIAL_TIER: PlanTierValue = "S"

/// แพ็กเกจมาตรฐาน 6 ระยะ × 4 tier — ราคาสุทธิ "ตั้งตรง ๆ" ตามตารางใน spec (ปัดเป็นเลขกลม ไม่คำนวณ)
/// code = `${tier}-${durationCode}` เช่น S-D7, M-M3 · version 1 ถูก seed ตอน migrate
export const STANDARD_DURATIONS: { code: string; days: number; label: string }[] = [
  { code: "D7", days: 7, label: "7 วัน" },
  { code: "D15", days: 15, label: "15 วัน" },
  { code: "D30", days: 30, label: "30 วัน" },
  { code: "M3", days: 90, label: "3 เดือน" },
  { code: "M6", days: 180, label: "6 เดือน" },
  { code: "M12", days: 365, label: "1 ปี" },
]

export const STANDARD_PRICES: Record<PlanTierValue, Record<string, number>> = {
  S: { D7: 70, D15: 145, D30: 280, M3: 800, M6: 1500, M12: 2800 },
  M: { D7: 140, D15: 290, D30: 560, M3: 1600, M6: 3000, M12: 5600 },
  L: { D7: 245, D15: 505, D30: 980, M3: 2800, M6: 5250, M12: 9800 },
  XL: { D7: 420, D15: 870, D30: 1680, M3: 4800, M6: 9000, M12: 16800 },
}

export type StandardPlanSeed = {
  code: string
  name: string
  tier: PlanTierValue
  tableLimit: number
  durationDays: number
  ratePerDay: number
  discountPercent: number
  price: number
  sortOrder: number
}

/// รายการแพ็กเกจมาตรฐานทั้ง 24 ใบ (สำหรับ seed/migration) — ส่วนลด = 1 − ราคาสุทธิ / (เรต × วัน) ปัด 2 ตำแหน่ง
export function standardPlanSeeds(): StandardPlanSeed[] {
  const seeds: StandardPlanSeed[] = []
  TIER_ORDER.forEach((tier, tierIndex) => {
    STANDARD_DURATIONS.forEach((duration, durationIndex) => {
      const spec = TIER_SPEC[tier]
      const listPrice = spec.ratePerDay * duration.days
      const price = STANDARD_PRICES[tier][duration.code]
      seeds.push({
        code: `${tier}-${duration.code}`,
        name: `${tier} · ${duration.label}`,
        tier,
        tableLimit: spec.tableLimit,
        durationDays: duration.days,
        ratePerDay: spec.ratePerDay,
        discountPercent: Math.round((1 - price / listPrice) * 10000) / 100,
        price,
        sortOrder: tierIndex * 10 + durationIndex,
      })
    })
  })
  return seeds
}

/// ช่วงเวลาของการต่ออายุแบบต่อท้าย (stack): เริ่มนับจากวันหมดอายุเดิมถ้ายังไม่หมด — จ่ายล่วงหน้าไม่เสียวันที่เหลือ
export function computeRenewalPeriod(now: Date, currentExpiresAt: Date | null, days: number): { start: Date; end: Date } {
  const start = currentExpiresAt && currentExpiresAt.getTime() > now.getTime() ? currentExpiresAt : now
  return { start, end: new Date(start.getTime() + days * DAY_MS) }
}

/// วันที่เหลือ (ปัดขึ้น) — 0 เมื่อหมดอายุแล้วหรือไม่มีแพ็กเกจ
export function remainingDays(now: Date, expiresAt: Date | null): number {
  if (!expiresAt) return 0
  const diff = expiresAt.getTime() - now.getTime()
  return diff <= 0 ? 0 : Math.ceil(diff / DAY_MS)
}

/// ยังขายได้ไหม — null = ยังไม่มีแพ็กเกจ, อดีต = หมดอายุ
export function isPlanActive(now: Date, expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() > now.getTime()
}

/// ส่วนต่างอัปเกรดกลางทาง: (เรตใหม่ − เรตเดิม) × วันที่เหลือ ไม่มีส่วนลด ปัดขึ้นเป็นบาทเต็ม
/// ดาวน์เกรดหรือ tier เท่าเดิม → 0 (แต่ action จะปฏิเสธก่อนถึงตรงนี้)
export function computeUpgradeAmount(fromRatePerDay: number, toRatePerDay: number, daysLeft: number): number {
  const delta = toRatePerDay - fromRatePerDay
  if (delta <= 0 || daysLeft <= 0) return 0
  return Math.ceil(delta * daysLeft)
}

/// ระดับการเตือนหมดอายุจากวันที่เหลือ: 7 / 3 / 1 (วันสุดท้าย) · 0 = ยังไม่ต้องเตือน · -1 = หมดอายุแล้ว
export function expiryNoticeLevel(now: Date, expiresAt: Date | null): 0 | 1 | 3 | 7 | -1 {
  if (!expiresAt) return -1
  const left = remainingDays(now, expiresAt)
  if (left <= 0) return -1
  if (left <= 1) return 1
  if (left <= 3) return 3
  if (left <= 7) return 7
  return 0
}

/// normalize เลขพร้อมเพย์ให้เทียบกันได้ทุกรูปแบบการเขียน:
///   เบอร์โทร  081-234-5678 / 0812345678 / +66812345678 / 66812345678 → 0812345678
///   เลขบัตรประชาชน 13 หลัก / e-Wallet 15 หลัก → ตัวเลขล้วน
/// คืน null ถ้าไม่เข้ารูปแบบใดเลย
export function normalizePromptPayId(raw: string): string | null {
  let digits = raw.replace(/\D/g, "")
  if (digits.startsWith("66") && digits.length === 11) digits = `0${digits.slice(2)}`
  if (digits.length === 10 && digits.startsWith("0")) return digits
  if (digits.length === 13 || digits.length === 15) return digits
  return null
}

/// เลขอ้างอิงคำขอชำระค่าใช้งานให้ร้านใส่ในบันทึกโอน — สั้น อ่านง่าย ไม่มี 0/O 1/I
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
export function subscriptionRequestRef(randomBytes: Uint8Array): string {
  return refWithPrefix("SUB-", randomBytes)
}

/// เลขอ้างอิงใบจ่ายรวมของแบรนด์ (Phase 14c) — คนละ prefix กับแถวลูก ผู้ดูแลจะได้รู้ทันทีว่าเป็นใบรวม
export function batchRequestRef(randomBytes: Uint8Array): string {
  return refWithPrefix("BAT-", randomBytes)
}

function refWithPrefix(prefix: string, randomBytes: Uint8Array): string {
  let out = prefix
  for (let i = 0; i < 6; i += 1) out += REF_ALPHABET[randomBytes[i] % REF_ALPHABET.length]
  return out
}
