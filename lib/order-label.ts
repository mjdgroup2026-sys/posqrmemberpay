/// ป้ายกำกับออร์เดอร์ที่ครัวและใบทิกเก็ตเห็น (Phase 17c)
///
/// ก่อน 17c ทุกออร์เดอร์ผูกโต๊ะ ป้ายจึงเป็นรหัสโต๊ะเสมอ · ออร์เดอร์กลับบ้านไม่มีโต๊ะ
/// ต้องมีอะไรให้ครัวกับคนส่งของเรียกลูกค้าได้ — ใช้เลขคิวของวันนั้นและชื่อที่พนักงานกรอกไว้
/// **ที่เดียวที่ประกอบข้อความนี้** — KDS, ทิกเก็ต PDF และเครื่องพิมพ์ครัวต้องเห็นเหมือนกันเป๊ะ

export type OrderLabelInput = {
  orderType: "DINE_IN" | "TAKEAWAY"
  /// รหัสโต๊ะ — ออร์เดอร์กลับบ้านเป็น null
  tableCode: string | null
  /// เลขรอบสั่งของ session (กินที่ร้าน) หรือเลขคิวของวัน (กลับบ้าน)
  orderNumber: number
  /// ชื่อ/เบอร์ 4 ตัวท้ายของลูกค้า (ไม่บังคับ)
  customerLabel?: string | null
}

export function orderTicketLabel(input: OrderLabelInput): string {
  if (input.orderType === "TAKEAWAY") {
    const name = input.customerLabel?.trim()
    return name ? `กลับบ้าน #${input.orderNumber} · ${name}` : `กลับบ้าน #${input.orderNumber}`
  }
  return input.tableCode ?? "-"
}
