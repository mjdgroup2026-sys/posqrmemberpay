import { describe, expect, it } from "vitest"
import { computeBillTotals } from "@/lib/close-session"

/// สูตรยอดบิลโต๊ะ + ส่วนลด (2026-10-05) — ส่วนลดหักจากค่าอาหารก่อน แล้วค่อยคิดค่าบริการ
describe("computeBillTotals", () => {
  const lines = [{ quantity: 2, unitPrice: 50 }]

  it("ไม่มีส่วนลด — เหมือนเดิมทุกประการ", () => {
    expect(computeBillTotals(lines, 10)).toEqual({ itemsTotal: 100, discount: 0, serviceCharge: 10, subtotal: 110, total: 110 })
    expect(computeBillTotals(lines, 10, { discountMode: null, discountValue: null }).total).toBe(110)
  })

  it("ลดเป็นบาท — ค่าบริการคิดจากยอดหลังหัก · subtotal = ค่าอาหาร + ค่าบริการ", () => {
    expect(computeBillTotals(lines, 10, { discountMode: "AMOUNT", discountValue: 20 })).toEqual({
      itemsTotal: 100,
      discount: 20,
      serviceCharge: 8,
      subtotal: 108,
      total: 88,
    })
  })

  it("ลดเป็น % — โตตามรายการที่สั่งเพิ่ม", () => {
    expect(computeBillTotals(lines, 0, { discountMode: "PERCENT", discountValue: 10 }).discount).toBe(10)
    expect(computeBillTotals([...lines, { quantity: 1, unitPrice: 100 }], 0, { discountMode: "PERCENT", discountValue: 10 }).discount).toBe(20)
  })

  it("ส่วนลดบาทเกินค่าอาหาร (ยกเลิกรายการทีหลัง) ถูกตัดเหลือเท่าค่าอาหาร — บิลไม่ติดลบ", () => {
    const totals = computeBillTotals([{ quantity: 1, unitPrice: 30 }], 10, { discountMode: "AMOUNT", discountValue: 50 })
    expect(totals).toEqual({ itemsTotal: 30, discount: 30, serviceCharge: 0, subtotal: 30, total: 0 })
  })

  it("รับ Decimal ของ Prisma (มี toString) ได้", () => {
    const decimalLike = { toString: () => "15.50", valueOf: () => 15.5 }
    expect(computeBillTotals(lines, 0, { discountMode: "AMOUNT", discountValue: decimalLike }).total).toBe(84.5)
  })
})
