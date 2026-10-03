import { describe, expect, it } from "vitest"
import { discountNoteText, resolveDiscount } from "@/lib/discount"

describe("resolveDiscount — ส่วนลดท้ายบิลจอขาย", () => {
  it("ไม่กรอก = 0", () => {
    expect(resolveDiscount(160, "AMOUNT", 0)).toEqual({ ok: true, amount: 0 })
  })

  it("บาท: ปัดทศนิยม 2 ตำแหน่ง · ห้ามเกินยอด", () => {
    expect(resolveDiscount(160, "AMOUNT", 19.999)).toEqual({ ok: true, amount: 20 })
    expect(resolveDiscount(160, "AMOUNT", 160)).toEqual({ ok: true, amount: 160 })
    expect(resolveDiscount(160, "AMOUNT", 160.01).ok).toBe(false)
  })

  it("%: คิดจากยอดรวม · ห้ามเกิน 100", () => {
    expect(resolveDiscount(155, "PERCENT", 10)).toEqual({ ok: true, amount: 15.5 })
    expect(resolveDiscount(99.99, "PERCENT", 33)).toEqual({ ok: true, amount: 33 })
    expect(resolveDiscount(160, "PERCENT", 100)).toEqual({ ok: true, amount: 160 })
    expect(resolveDiscount(160, "PERCENT", 100.1).ok).toBe(false)
  })

  it("ติดลบ / ไม่ใช่ตัวเลข → ไม่ผ่าน", () => {
    expect(resolveDiscount(160, "AMOUNT", -1).ok).toBe(false)
    expect(resolveDiscount(160, "PERCENT", Number.NaN).ok).toBe(false)
  })

  it("ข้อความหมายเหตุ", () => {
    expect(discountNoteText("PERCENT", 10, "โปรสมาชิก")).toBe("ส่วนลด 10% (โปรสมาชิก)")
    expect(discountNoteText("AMOUNT", 20, undefined)).toBe("ส่วนลด")
  })
})
