export type FieldErrors = Record<string, string>

/// ผลลัพธ์มาตรฐานของทุก Server Action — ไม่ throw ให้ผู้ใช้เห็น
/// `data` ไว้ส่งค่าที่ฝั่ง client ต้องใช้ต่อทันที (เช่น ใบเสร็จหลัง checkout) โดยไม่ต้องยิงถามซ้ำ
export type ActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string; fieldErrors?: FieldErrors }

/// สิทธิ์ที่หน้า (server) ส่งให้ client component ซ่อน/ปิดปุ่ม (§4 — Phase 16) · ค่าเริ่มต้นเต็มเพื่อให้เทส component เดิมไม่พัง
/// ⚠️ เป็นแค่ความสะดวก — ด่านจริงคือ requireStoreAccess()/guardAction() ใน Server Action
export type AllowedActions = readonly ("VIEW" | "ADD" | "EDIT" | "DELETE")[]
export const FULL_ACCESS: AllowedActions = ["VIEW", "ADD", "EDIT", "DELETE"]

export type PaymentMethodValue = "CASH" | "TRANSFER" | "QR" | "PROMPTPAY" | "CARD"

/// วิธีชำระเงินที่เลือกได้บนหน้าขายหน้าร้าน — PROMPTPAY/CARD เป็นของช่องทาง MJD Mobile Order เท่านั้น
export const RETAIL_PAYMENT_METHODS = ["CASH", "TRANSFER", "QR"] as const

export const PAYMENT_METHOD_LABEL: Record<PaymentMethodValue, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  QR: "สแกน QR",
  PROMPTPAY: "พร้อมเพย์",
  CARD: "บัตรเครดิต/เดบิต",
}

export type ReceiptLine = {
  /// รหัสสินค้าคลัง — บิลอาหาร (Phase 17c) ใช้ menuItemId แทน
  productId: string
  /// SKU/หน่วยนับมีเฉพาะสินค้าคลัง — เมนูอาหารไม่มี จึงเป็น optional
  sku?: string
  name: string
  unit?: string
  quantity: number
  unitPrice: number
  subtotal: number
}

/// ข้อมูลใบเสร็จที่ createSale ส่งกลับให้หน้าจอพิมพ์ได้ทันที
export type ReceiptData = {
  id: string
  saleNumber: string
  createdAt: string
  cashierName: string
  items: ReceiptLine[]
  subtotal: number
  discount: number
  total: number
  paymentMethod: PaymentMethodValue
  amountReceived: number
  changeDue: number
  note?: string
}
