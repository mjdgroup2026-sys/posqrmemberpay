/// ส่วนลดท้ายบิลที่พนักงานกรอกเองตอนขายกลับบ้าน/ขายสินค้าจากจอขาย (2026-10-03)
///
/// ใช้ทั้งฝั่งจอ (โชว์ยอดสุทธิ/QR) และ server (`createTakeawaySale`) — สูตรเดียวกันตัวเลขบนจอกับในบิลจึงตรงกัน
/// · server คิดใหม่จากยอดที่คำนวณสดเสมอ ไม่เชื่อยอดส่วนลดที่ client ส่งมา
/// · ยังไม่มีส่วนลดของบิลโต๊ะ (ต้องเก็บกับ TableSession ให้ทุกเส้นทางปิดบิลเห็นตรงกัน — งานแยก)
export type DiscountMode = "AMOUNT" | "PERCENT"

export type DiscountResult = { ok: true; amount: number } | { ok: false; error: string }

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function resolveDiscount(subtotal: number, mode: DiscountMode, value: number): DiscountResult {
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: "ส่วนลดต้องเป็นตัวเลขไม่ติดลบ" }
  if (value === 0) return { ok: true, amount: 0 }
  if (mode === "PERCENT") {
    if (value > 100) return { ok: false, error: "ส่วนลดต้องไม่เกิน 100%" }
    return { ok: true, amount: round2((subtotal * value) / 100) }
  }
  const amount = round2(value)
  if (amount > subtotal) return { ok: false, error: "ส่วนลดต้องไม่เกินยอดรวม" }
  return { ok: true, amount }
}

/// ข้อความส่วนลดที่ต่อท้ายหมายเหตุบิล — ให้ดูย้อนหลังได้ว่าลดเพราะอะไร (ใครลดดูจาก cashierId ของบิล)
export function discountNoteText(mode: DiscountMode, value: number, note: string | undefined): string {
  const label = mode === "PERCENT" ? `ส่วนลด ${value}%` : "ส่วนลด"
  return note ? `${label} (${note})` : label
}
