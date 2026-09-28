import { describe, expect, it } from "vitest"
import { daysOfStockLeft, suggestReorderQty } from "@/lib/reorder"

/// สูตรจำนวนแนะนำให้สั่งซื้อ (Phase 21c · F33) — ขายเฉลี่ย 30 วัน ให้พอขายอีก 14 วันเหนือจุดสั่งซื้อ
describe("suggestReorderQty", () => {
  it("มียอดขาย: จุดสั่งซื้อ + ceil(เฉลี่ย × 14) − คงเหลือ", () => {
    expect(suggestReorderQty({ quantity: 9, reorderPoint: 10, avgDailySold: 1.7 })).toBe(25)
    expect(suggestReorderQty({ quantity: 0, reorderPoint: 5, avgDailySold: 2 })).toBe(33)
  })

  it("ยังไม่เคยขาย: เติมให้ถึง 2 เท่าของจุดสั่งซื้อ", () => {
    expect(suggestReorderQty({ quantity: 3, reorderPoint: 10, avgDailySold: 0 })).toBe(17)
  })

  it("สั่งอย่างน้อย 1 เสมอ แม้เป้าต่ำกว่าคงเหลือ (เช่น จุดสั่งซื้อ 0 ของหมด)", () => {
    expect(suggestReorderQty({ quantity: 0, reorderPoint: 0, avgDailySold: 0 })).toBe(1)
    expect(suggestReorderQty({ quantity: 40, reorderPoint: 10, avgDailySold: 0 })).toBe(1)
  })
})

describe("daysOfStockLeft", () => {
  it("ปัดลงเป็นวันเต็ม · ไม่มียอดขาย = null", () => {
    expect(daysOfStockLeft(9, 1.7)).toBe(5)
    expect(daysOfStockLeft(0, 3)).toBe(0)
    expect(daysOfStockLeft(10, 0)).toBeNull()
  })
})
