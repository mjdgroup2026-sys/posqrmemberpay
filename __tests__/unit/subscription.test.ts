import { describe, expect, it } from "vitest"
import {
  computeRenewalPeriod,
  computeUpgradeAmount,
  DAY_MS,
  expiryNoticeLevel,
  isPlanActive,
  normalizePromptPayId,
  remainingDays,
  standardPlanSeeds,
  STANDARD_PRICES,
  subscriptionRequestRef,
  TIER_SPEC,
} from "@/lib/subscription"
import { hashPromptPayId } from "@/lib/subscription-hash"

const NOW = new Date("2026-09-15T12:00:00.000Z")
const days = (n: number) => new Date(NOW.getTime() + n * DAY_MS)

describe("ค่าใช้งานแบบต่ออายุ — คำนวณล้วน (Phase 14b)", () => {
  describe("computeRenewalPeriod — ต่อท้ายไม่เสียวันที่เหลือ", () => {
    it("ยังเหลือ 10 วัน ต่ออีก 30 → หมดอายุ +40 วันจากวันนี้ ไม่ใช่ +30", () => {
      const { start, end } = computeRenewalPeriod(NOW, days(10), 30)
      expect(start).toEqual(days(10))
      expect(end).toEqual(days(40))
    })
    it("หมดอายุแล้ว → เริ่มนับจากวันนี้", () => {
      const { start, end } = computeRenewalPeriod(NOW, days(-5), 30)
      expect(start).toEqual(NOW)
      expect(end).toEqual(days(30))
    })
    it("ยังไม่มีแพ็กเกจ (null) → เริ่มนับจากวันนี้", () => {
      expect(computeRenewalPeriod(NOW, null, 7).end).toEqual(days(7))
    })
  })

  describe("remainingDays / isPlanActive", () => {
    it("ปัดขึ้น: เหลือ 2.1 วัน = 3", () => {
      expect(remainingDays(NOW, new Date(NOW.getTime() + 2.1 * DAY_MS))).toBe(3)
    })
    it("หมดอายุ/ไม่มีแพ็กเกจ = 0 และไม่ active", () => {
      expect(remainingDays(NOW, days(-1))).toBe(0)
      expect(remainingDays(NOW, null)).toBe(0)
      expect(isPlanActive(NOW, null)).toBe(false)
      expect(isPlanActive(NOW, days(-1))).toBe(false)
      expect(isPlanActive(NOW, days(1))).toBe(true)
    })
  })

  describe("computeUpgradeAmount — ส่วนต่าง × วันที่เหลือ ไม่มีส่วนลด ปัดขึ้น", () => {
    it("S→M เหลือ 20 วัน = (20−10)×20 = 200", () => {
      expect(computeUpgradeAmount(TIER_SPEC.S.ratePerDay, TIER_SPEC.M.ratePerDay, 20)).toBe(200)
    })
    it("M→XL เหลือ 7 วัน = (60−20)×7 = 280", () => {
      expect(computeUpgradeAmount(20, 60, 7)).toBe(280)
    })
    it("ดาวน์เกรด / เท่าเดิม / ไม่มีวันเหลือ → 0", () => {
      expect(computeUpgradeAmount(20, 10, 20)).toBe(0)
      expect(computeUpgradeAmount(20, 20, 20)).toBe(0)
      expect(computeUpgradeAmount(10, 20, 0)).toBe(0)
    })
  })

  describe("expiryNoticeLevel — 7 / 3 / 1", () => {
    it.each([
      [10, 0],
      [7, 7],
      [5, 7],
      [3, 3],
      [2, 3],
      [1, 1],
      [0.5, 1],
      [-1, -1],
    ] as const)("เหลือ %s วัน → ระดับ %s", (left, level) => {
      expect(expiryNoticeLevel(NOW, new Date(NOW.getTime() + left * DAY_MS))).toBe(level)
    })
    it("ไม่มีแพ็กเกจ → -1", () => {
      expect(expiryNoticeLevel(NOW, null)).toBe(-1)
    })
  })

  describe("normalizePromptPayId — เลขเดียวกันเขียนต่างรูปแบบต้องได้ค่าเดียว", () => {
    it("เบอร์โทร 4 รูปแบบ → 0812345678", () => {
      for (const raw of ["081-234-5678", "0812345678", "+66812345678", "66 81 234 5678", "081 234 5678"]) {
        expect(normalizePromptPayId(raw), raw).toBe("0812345678")
      }
    })
    it("เลขบัตรประชาชน 13 หลัก / e-Wallet 15 หลัก ผ่าน", () => {
      expect(normalizePromptPayId("1-2345-67890-12-3")).toBe("1234567890123")
      expect(normalizePromptPayId("004999012345678")).toBe("004999012345678")
    })
    it("รูปแบบอื่นไม่ผ่าน", () => {
      expect(normalizePromptPayId("12345")).toBeNull()
      expect(normalizePromptPayId("8123456789")).toBeNull()
      expect(normalizePromptPayId("abc")).toBeNull()
    })
    it("hash เท่ากันเมื่อ normalize แล้วตรงกัน และไม่มีเลขดิบใน hash", () => {
      const a = hashPromptPayId("0812345678")
      expect(hashPromptPayId(normalizePromptPayId("+66812345678") ?? "")).toBe(a)
      expect(a).toMatch(/^[0-9a-f]{64}$/)
      expect(a).not.toContain("0812345678")
    })
  })

  describe("standardPlanSeeds — ตารางแพ็กเกจตาม spec", () => {
    const seeds = standardPlanSeeds()
    it("24 ใบ = 4 tier × 6 ระยะ code ไม่ซ้ำ", () => {
      expect(seeds).toHaveLength(24)
      expect(new Set(seeds.map((s) => s.code)).size).toBe(24)
    })
    it("ราคาตรงตาราง และส่วนลดยาวขึ้น = มากขึ้น", () => {
      const s = seeds.filter((p) => p.tier === "S").sort((a, b) => a.durationDays - b.durationDays)
      expect(s.map((p) => p.price)).toEqual([70, 145, 280, 800, 1500, 2800])
      expect(s[0].discountPercent).toBe(0)
      for (let i = 1; i < s.length; i += 1) expect(s[i].discountPercent).toBeGreaterThan(s[i - 1].discountPercent)
      expect(seeds.find((p) => p.code === "XL-M12")?.price).toBe(STANDARD_PRICES.XL.M12)
      expect(seeds.find((p) => p.code === "L-D30")).toMatchObject({ tableLimit: 60, ratePerDay: 35, durationDays: 30, price: 980 })
    })
  })

  it("subscriptionRequestRef — SUB- + 6 ตัวจากชุดที่ไม่มี 0/O/1/I", () => {
    const ref = subscriptionRequestRef(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
    expect(ref).toMatch(/^SUB-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/)
  })
})
