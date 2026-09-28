/// ชนิดเอกสารคลังที่ใช้ใน URL และหน้าจอ (Phase 21) — ไฟล์นี้ไม่มี server-only ใช้ได้ทั้ง Server/Client Component
///
/// `/stock/receipts` · `/stock/issues` · `/stock/adjustments` ใช้หน้าและ component ชุดเดียวกัน ต่างกันแค่ค่าในตารางนี้

export type StockDocTypeValue = "RECEIPT" | "ISSUE" | "ADJUST"
export type StockDocSlug = "receipts" | "issues" | "adjustments"

export type StockDocKind = {
  slug: StockDocSlug
  type: StockDocTypeValue
  resource: "STOCK_IN" | "STOCK_OUT" | "STOCK_ADJUST"
  title: string
  newTitle: string
  description: string
  /// หัวคอลัมน์ "ผู้เกี่ยวข้อง" ในตารางรายการเอกสาร
  partyLabel: string
}

export const STOCK_DOC_KINDS: Record<StockDocSlug, StockDocKind> = {
  receipts: {
    slug: "receipts",
    type: "RECEIPT",
    resource: "STOCK_IN",
    title: "ใบรับสินค้า",
    newTitle: "สร้างใบรับสินค้า",
    description: "เอกสารซื้อ/รับของเข้าคลัง — บันทึกแล้วเพิ่มสต็อกทันที ยกเลิกได้ด้วยรายการชดเชย",
    partyLabel: "ผู้ขาย",
  },
  issues: {
    slug: "issues",
    type: "ISSUE",
    resource: "STOCK_OUT",
    title: "ใบเบิกสินค้า",
    newTitle: "สร้างใบเบิกสินค้า",
    description: "เบิกของออกจากคลังพร้อมชื่อผู้เบิก — ระบบกันเบิกเกินยอดคงเหลือ ถ้าบรรทัดไหนไม่พอจะไม่บันทึกทั้งใบ",
    partyLabel: "ผู้เบิก",
  },
  adjustments: {
    slug: "adjustments",
    type: "ADJUST",
    resource: "STOCK_ADJUST",
    title: "ใบปรับยอดสต็อก",
    newTitle: "สร้างใบปรับยอดสต็อก",
    description: "กรอกยอดที่นับได้จริง ระบบคิดส่วนต่างจากยอดในระบบ ณ ตอนบันทึกให้เอง",
    partyLabel: "เหตุผล",
  },
}

export const SLUG_OF_TYPE: Record<StockDocTypeValue, StockDocSlug> = {
  RECEIPT: "receipts",
  ISSUE: "issues",
  ADJUST: "adjustments",
}

export function stockDocKind(slug: string): StockDocKind | null {
  return slug in STOCK_DOC_KINDS ? STOCK_DOC_KINDS[slug as StockDocSlug] : null
}
