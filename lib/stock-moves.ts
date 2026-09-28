import type { StoreTx } from "@/lib/db"

/// ตัด/เติมสต็อก 1 สินค้า (Phase 21) — ที่เดียวที่ทางใหม่ทุกทางใช้ขยับ `Product.quantity`
///
/// ใช้ร่วมกันทั้งเอกสารคลัง (`lib/stock-docs.ts`), จอขายอาหาร (ขายกลับบ้าน/สั่งเข้าโต๊ะ) และการยกเลิกรายการ/โต๊ะ
/// · ทุกครั้งเขียน `StockTransaction` คู่กันใน tx เดียวกัน (กติกาข้อ 2) และไม่แก้แถวเก่า (ข้อ 3)
/// · ตัดออกใช้ `updateMany where quantity gte` เป็นด่านเดียวกัน race (ข้อ 4) — ห้ามเช็ค if ก่อนแล้วค่อยลด
/// ⚠️ ผู้เรียกต้องส่ง tx ที่มาจาก `forStore(storeId).$transaction` — product ถูกกรอง storeId ให้แล้ว
///    จึงตัดสต็อกของร้านอื่นด้วย productId ที่ปลอมมาไม่ได้ (จะได้ StockMissing)

export type StockLink = {
  note?: string | null
  saleId?: string | null
  documentId?: string | null
  orderItemId?: string | null
}

/// ของไม่พอ — เก็บชื่อ/ยอดไว้ให้ผู้เรียกประกอบข้อความไทยตามบริบท (เบิก / ขาย / ยกเลิกใบรับ)
export class StockShortage extends Error {
  constructor(
    readonly productId: string,
    readonly productName: string,
    readonly available: number,
    readonly requested: number,
    readonly unit: string,
  ) {
    super("STOCK_SHORTAGE")
  }

  /// "น้ำปลา ไม่พอ — ต้องการ 5 ขวด แต่มีอยู่ 3 ขวด"
  get reason(): string {
    return `${this.productName} ไม่พอ — ต้องการ ${this.requested} ${this.unit} แต่มีอยู่ ${this.available} ${this.unit}`
  }
}

/// ไม่พบสินค้า (ลบไปแล้ว หรือเป็นของร้านอื่น)
export class StockMissing extends Error {
  constructor(readonly productId: string) {
    super("STOCK_MISSING")
  }
}

export async function takeStock(
  tx: StoreTx,
  storeId: string,
  productId: string,
  quantity: number,
  link: StockLink = {},
): Promise<void> {
  if (quantity <= 0) return
  // ★ ด่านกันขาย/เบิกเกิน — conditional update ตัวเดียวที่กัน race ได้จริง (กติกาข้อ 4)
  const updated = await tx.product.updateMany({
    where: { id: productId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  })
  if (updated.count === 0) {
    const current = await tx.product.findUnique({
      where: { id: productId },
      select: { name: true, unit: true, quantity: true },
    })
    if (!current) throw new StockMissing(productId)
    throw new StockShortage(productId, current.name, current.quantity, quantity, current.unit)
  }
  await tx.stockTransaction.create({
    data: { storeId, productId, type: "OUT", quantity, ...linkData(link) },
  })
}

export async function putStock(
  tx: StoreTx,
  storeId: string,
  productId: string,
  quantity: number,
  link: StockLink = {},
): Promise<void> {
  if (quantity <= 0) return
  const updated = await tx.product.updateMany({
    where: { id: productId },
    data: { quantity: { increment: quantity } },
  })
  if (updated.count === 0) throw new StockMissing(productId)
  await tx.stockTransaction.create({
    data: { storeId, productId, type: "IN", quantity, ...linkData(link) },
  })
}

function linkData(link: StockLink) {
  return {
    note: link.note ?? null,
    saleId: link.saleId ?? null,
    documentId: link.documentId ?? null,
    orderItemId: link.orderItemId ?? null,
  }
}
