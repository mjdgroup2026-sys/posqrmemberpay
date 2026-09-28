/// สูตรจำนวนแนะนำให้สั่งซื้อ (Phase 21c · F33) — ที่เดียว ใช้ทั้งรายงาน /reports/reorder และตอนเติมบรรทัดในใบรับ
///
/// ตัดสินใจ 2026-09-28: ดูยอดขายเฉลี่ยย้อนหลัง 30 วัน แล้วสั่งให้พอขายต่อไปอีก 14 วัน เหนือจุดสั่งซื้อ
/// · ยังไม่เคยขาย (เฉลี่ย 0) = เติมให้ถึง 2 เท่าของจุดสั่งซื้อ · สั่งอย่างน้อย 1 เสมอ (อยู่ในรายงานแปลว่าต้องเติม)

export const REORDER_LOOKBACK_DAYS = 30
export const REORDER_COVER_DAYS = 14

export function suggestReorderQty(input: { quantity: number; reorderPoint: number; avgDailySold: number }): number {
  const target =
    input.avgDailySold > 0
      ? input.reorderPoint + Math.ceil(input.avgDailySold * REORDER_COVER_DAYS)
      : input.reorderPoint * 2
  return Math.max(target - input.quantity, 1)
}

/// อยู่ได้อีกกี่วันด้วยยอดขายเฉลี่ย — null = ยังไม่มียอดขายให้คำนวณ
export function daysOfStockLeft(quantity: number, avgDailySold: number): number | null {
  if (avgDailySold <= 0) return null
  return Math.max(Math.floor(quantity / avgDailySold), 0)
}
