/// ช่องทางชำระเงินที่ปิดรอบแยกถัง (20g) — ลำดับตายตัว ใช้ทั้งหน้าปิดรอบ ประวัติ และสรุปทั้งร้าน
/// ไฟล์นี้ไม่มี server-only — ฟอร์มปิดรอบฝั่ง client ใช้ชื่อ/ลำดับชุดเดียวกัน
export const CLOSING_CHANNELS = ["CASH", "TRANSFER", "QR", "PROMPTPAY", "CARD"] as const
export type ClosingChannel = (typeof CLOSING_CHANNELS)[number]

export const CLOSING_CHANNEL_LABEL: Record<ClosingChannel, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  QR: "QR หน้าร้าน",
  PROMPTPAY: "พร้อมเพย์",
  CARD: "บัตร (EDC)",
}

/// ชื่อฟิลด์ในฟอร์ม/ตาราง CashierClosing ของยอดจริงที่กรอก — เงินสดบังคับ ช่องอื่นไม่บังคับ
export const COUNTED_FIELD: Record<ClosingChannel, "countedCash" | "countedTransfer" | "countedQR" | "countedPromptPay" | "countedCard"> = {
  CASH: "countedCash",
  TRANSFER: "countedTransfer",
  QR: "countedQR",
  PROMPTPAY: "countedPromptPay",
  CARD: "countedCard",
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/// แปลงยอดตาม paymentMethod เป็นยอดแยกถัง — **ที่เดียว**ที่ตัดสินว่าวิธีชำระไหนลงถังไหน
/// (หน้าปิดรอบ · closeCashierDay · สรุปทั้งร้าน ใช้ตัวเดียวกัน ตัวเลขบนจอกับที่บันทึกจึงตรงกันเสมอ)
/// วิธีชำระที่ไม่รู้จัก (เพิ่ม enum ใหม่ในอนาคต) ตกถังบัตร เพื่อให้ผลรวมยังเท่ายอดขาย
export function bucketByChannel(rows: { paymentMethod: string; total: number; bills: number }[]) {
  const totals: Record<ClosingChannel, number> = { CASH: 0, TRANSFER: 0, QR: 0, PROMPTPAY: 0, CARD: 0 }
  let totalSales = 0
  let billCount = 0
  for (const row of rows) {
    const channel = (CLOSING_CHANNELS as readonly string[]).includes(row.paymentMethod) ? (row.paymentMethod as ClosingChannel) : "CARD"
    totals[channel] = round2(totals[channel] + row.total)
    totalSales = round2(totalSales + row.total)
    billCount += row.bills
  }
  return { totals, totalSales, billCount }
}
