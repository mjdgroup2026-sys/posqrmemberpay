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

/// ชนิดที่นั่ง (ตรงกับ enum `TableKind`) — ประกาศเองที่นี่เพื่อให้ client component import ได้โดยไม่ลาก Prisma มา
export type PlaceKind = "TABLE" | "ROOM"

/// คำเรียกที่นั่ง (2026-10-08 เจ้าของสั่ง) — ห้องนวด (`Table.kind = ROOM`) = "ห้อง" · โต๊ะปกติ = "โต๊ะ"
///
/// ★ ตัดสินจาก **ตัวโต๊ะ** ไม่ใช่ประเภทร้าน — ร้านนวดมีทั้งห้องนวดและโต๊ะอาหาร (สวิตช์ร้านนวดเปิดเพิ่ม ไม่ใช่สลับโหมด)
/// ร้านอาหารล้วนไม่มีห้อง จึงเห็น "โต๊ะ" ทุกที่เหมือนเดิม · **ทุกจุดที่แสดงรหัสโต๊ะให้ผู้ใช้เห็นต้องผ่านตัวนี้** ห้ามเขียน "โต๊ะ" เอง
export function placeNoun(kind?: PlaceKind | null): string {
  return kind === "ROOM" ? "ห้อง" : "โต๊ะ"
}

export function placeLabel(kind: PlaceKind | null | undefined, code: string): string {
  return `${placeNoun(kind)} ${code}`
}

/// หัวทิกเก็ตครัว / การ์ด KDS / เครื่องพิมพ์ครัว — กลับบ้านใช้ป้ายจาก `orderTicketLabel` ตรง ๆ · กินที่ร้านเติมคำว่าโต๊ะ/ห้อง
export function ticketHeading(input: { orderType: "DINE_IN" | "TAKEAWAY"; tableCode: string; tableKind?: PlaceKind | null }): string {
  return input.orderType === "TAKEAWAY" ? input.tableCode : placeLabel(input.tableKind, input.tableCode)
}
