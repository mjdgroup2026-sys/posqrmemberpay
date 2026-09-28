import type { StoreTx } from "@/lib/db"
import type { StockDocType } from "@/generated/prisma/client"
import { putStock, takeStock } from "@/lib/stock-moves"
import { dateOnlyFromKey } from "@/lib/day"
import type { StockAdjustInput, StockIssueInput, StockReceiptInput } from "@/lib/validation"

/// เอกสารคลัง รับ/เบิก/ปรับ (Phase 21) — ตรรกะที่เดียว ห้ามลอกไปเขียนใน action/หน้าอื่น
///
/// · บันทึกแล้วมีผลกับสต็อกทันที (ไม่มีร่าง) · แต่ละบรรทัดขยับสต็อกผ่าน `lib/stock-moves.ts` ซึ่งเขียน ledger คู่กันเสมอ
/// · ทั้งใบอยู่ในทรานแซคชันเดียว — บรรทัดไหนไม่พอ (ใบเบิก/ยกเลิกใบรับ) = rollback ทั้งใบ ไม่ตัดบางส่วน
/// · ยกเลิกเอกสาร = สร้างรายการชดเชยทุกบรรทัด ไม่แก้/ลบ ledger เดิม (กติกาข้อ 3)
/// ⚠️ ผู้เรียกต้องส่ง tx จาก `forStore(storeId).$transaction` — raw SQL ในไฟล์นี้กรอง storeId เองทุกจุด

export const DOC_PREFIX: Record<StockDocType, string> = {
  RECEIPT: "GR",
  ISSUE: "GI",
  ADJUST: "ADJ",
}

export const DOC_TYPE_LABEL: Record<StockDocType, string> = {
  RECEIPT: "ใบรับสินค้า",
  ISSUE: "ใบเบิกสินค้า",
  ADJUST: "ใบปรับยอดสต็อก",
}

/// namespace ของ advisory lock เลขเอกสาร — ต่อจาก 720_001 เลขบิล · 720_002 เพดานโต๊ะ · 720_003/4 การจอง
const DOC_NUMBER_LOCK_NAMESPACE = 720_005

/// ข้อผิดพลาดที่ผู้ใช้แก้เองได้ — เก็บข้อความไทยพร้อมแสดงไว้ในตัว
export class StockDocError extends Error {
  constructor(readonly reason: string) {
    super("STOCK_DOC_ERROR")
  }
}

/// เลขเอกสารถัดไป เช่น GR-000001 — เดินแยกต่อ "ร้าน + ประเภท" ใต้ advisory lock (เหตุผลเดียวกับเลขบิลใน `lib/sale-number.ts`)
export async function nextDocNumber(tx: StoreTx, storeId: string, type: StockDocType): Promise<string> {
  const prefix = DOC_PREFIX[type]
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(${DOC_NUMBER_LOCK_NAMESPACE}::int, hashtext(${storeId + ":" + type})::int)::text AS locked
  `
  const pattern = `^${prefix}-([0-9]+)$`
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("docNumber" FROM ${pattern}) AS INTEGER)) AS max
    FROM "stock_document"
    WHERE "storeId" = ${storeId} AND "docNumber" ~ ${pattern}
  `
  const max = rows[0]?.max ?? 0
  return `${prefix}-${String(max + 1).padStart(6, "0")}`
}

type ProductInfo = { id: string; name: string; unit: string }

/// ตรวจว่าสินค้าทุกบรรทัดเป็นของร้านนี้ (FK จากฟอร์ม — กติกาข้อ 5) · tx มาจาก forStore จึงเห็นเฉพาะของร้าน
async function loadProducts(tx: StoreTx, productIds: string[]): Promise<Map<string, ProductInfo>> {
  const rows = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, unit: true },
  })
  if (rows.length !== new Set(productIds).size) throw new StockDocError("มีสินค้าบางรายการไม่พบในร้านนี้ — กรุณาเลือกสินค้าใหม่")
  return new Map(rows.map((row) => [row.id, row]))
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

type PostContext = { storeId: string; userId: string; docDateKey: string }
export type PostedDoc = { id: string; docNumber: string }

export async function postReceipt(tx: StoreTx, ctx: PostContext, input: StockReceiptInput): Promise<PostedDoc> {
  await loadProducts(tx, input.lines.map((line) => line.productId))
  const costed = input.lines.filter((line) => line.unitCost !== undefined)
  const totalCost = costed.length > 0
    ? round2(costed.reduce((sum, line) => sum + (line.unitCost ?? 0) * line.quantity, 0))
    : null

  const docNumber = await nextDocNumber(tx, ctx.storeId, "RECEIPT")
  const doc = await tx.stockDocument.create({
    data: {
      storeId: ctx.storeId,
      type: "RECEIPT",
      docNumber,
      docDate: dateOnlyFromKey(ctx.docDateKey),
      supplierName: input.supplierName ?? null,
      referenceNo: input.referenceNo ?? null,
      note: input.note ?? null,
      totalCost: totalCost === null ? null : totalCost.toFixed(2),
      createdById: ctx.userId,
      lines: {
        create: input.lines.map((line, index) => ({
          lineNo: index + 1,
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost === undefined ? null : line.unitCost.toFixed(2),
          lineTotal: line.unitCost === undefined ? null : round2(line.unitCost * line.quantity).toFixed(2),
        })),
      },
    },
    select: { id: true, docNumber: true },
  })

  for (const line of input.lines) {
    await putStock(tx, ctx.storeId, line.productId, line.quantity, { documentId: doc.id, note: docNumber })
  }
  return doc
}

export async function postIssue(tx: StoreTx, ctx: PostContext, input: StockIssueInput): Promise<PostedDoc> {
  await loadProducts(tx, input.lines.map((line) => line.productId))

  const docNumber = await nextDocNumber(tx, ctx.storeId, "ISSUE")
  const doc = await tx.stockDocument.create({
    data: {
      storeId: ctx.storeId,
      type: "ISSUE",
      docNumber,
      docDate: dateOnlyFromKey(ctx.docDateKey),
      requesterName: input.requesterName,
      note: input.note ?? null,
      createdById: ctx.userId,
      lines: {
        create: input.lines.map((line, index) => ({ lineNo: index + 1, productId: line.productId, quantity: line.quantity })),
      },
    },
    select: { id: true, docNumber: true },
  })

  // ★ ทุกบรรทัดตัดผ่าน takeStock (updateMany gte · กติกาข้อ 4) — บรรทัดไหนไม่พอ StockShortage ทำให้ rollback ทั้งใบ
  //   ตัดตามลำดับ productId เสมอ กันสองใบที่มีสินค้าชุดเดียวกันล็อกแถวสลับลำดับกันจน deadlock
  for (const line of [...input.lines].sort((a, b) => (a.productId < b.productId ? -1 : 1))) {
    await takeStock(tx, ctx.storeId, line.productId, line.quantity, {
      documentId: doc.id,
      note: `${docNumber} · ผู้เบิก ${input.requesterName}`,
    })
  }
  return doc
}

/// ล็อกแถวสินค้าแล้วอ่านยอดปัจจุบัน — ใบปรับคิดส่วนต่างจากยอดนี้ จึงต้องไม่ให้ใครขาย/เบิกแทรกระหว่างอ่านกับเขียน
async function lockProductQuantity(tx: StoreTx, storeId: string, productId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT "quantity" FROM "product" WHERE "id" = ${productId} AND "storeId" = ${storeId} FOR UPDATE
  `
  if (rows.length === 0) throw new StockDocError("มีสินค้าบางรายการไม่พบในร้านนี้ — กรุณาเลือกสินค้าใหม่")
  return rows[0].quantity
}

export async function postAdjustment(tx: StoreTx, ctx: PostContext, input: StockAdjustInput): Promise<PostedDoc & { changed: number }> {
  await loadProducts(tx, input.lines.map((line) => line.productId))

  // ล็อกตามลำดับ productId เสมอ — สองใบปรับที่มีสินค้าชุดเดียวกันจะไม่ deadlock กัน
  const ordered = [...input.lines].sort((a, b) => (a.productId < b.productId ? -1 : 1))
  const systemQty = new Map<string, number>()
  for (const line of ordered) systemQty.set(line.productId, await lockProductQuantity(tx, ctx.storeId, line.productId))

  const docNumber = await nextDocNumber(tx, ctx.storeId, "ADJUST")
  const doc = await tx.stockDocument.create({
    data: {
      storeId: ctx.storeId,
      type: "ADJUST",
      docNumber,
      docDate: dateOnlyFromKey(ctx.docDateKey),
      reason: input.reason,
      note: input.note ?? null,
      createdById: ctx.userId,
      lines: {
        create: input.lines.map((line, index) => {
          const current = systemQty.get(line.productId) ?? 0
          return {
            lineNo: index + 1,
            productId: line.productId,
            quantity: line.countedQty - current,
            systemQty: current,
            countedQty: line.countedQty,
          }
        }),
      },
    },
    select: { id: true, docNumber: true },
  })

  let changed = 0
  for (const line of input.lines) {
    const diff = line.countedQty - (systemQty.get(line.productId) ?? 0)
    const link = { documentId: doc.id, note: `${docNumber} · ${input.reason}` }
    // ส่วนต่าง 0 = นับตรงกับระบบ บันทึกไว้ในเอกสารเป็นหลักฐานการนับ แต่ไม่เขียน ledger
    if (diff > 0) await putStock(tx, ctx.storeId, line.productId, diff, link)
    if (diff < 0) await takeStock(tx, ctx.storeId, line.productId, -diff, link)
    if (diff !== 0) changed += 1
  }
  return { ...doc, changed }
}

/// ยกเลิกเอกสาร — conditional update `status: POSTED` กันสองคนกดพร้อมกันแล้วชดเชยซ้ำสองรอบ
/// · ใบรับ: ตัดของที่รับเข้าออก (ถ้าขาย/เบิกไปแล้วจนเหลือไม่พอ = ปฏิเสธทั้งใบ) · ใบเบิก: คืนเข้า · ใบปรับ: กลับทิศส่วนต่าง
export async function voidStockDocument(
  tx: StoreTx,
  storeId: string,
  userId: string,
  documentId: string,
  reason: string,
): Promise<{ docNumber: string; type: StockDocType }> {
  const doc = await tx.stockDocument.findUnique({
    where: { id: documentId },
    select: { id: true, type: true, docNumber: true, status: true, lines: { select: { productId: true, quantity: true } } },
  })
  if (!doc) throw new StockDocError("ไม่พบเอกสารนี้")

  const marked = await tx.stockDocument.updateMany({
    where: { id: doc.id, status: "POSTED" },
    data: { status: "VOIDED", voidedAt: new Date(), voidedById: userId, voidReason: reason },
  })
  if (marked.count === 0) throw new StockDocError(`${doc.docNumber} ถูกยกเลิกไปแล้ว`)

  const link = { documentId: doc.id, note: `ยกเลิก ${doc.docNumber} — ${reason}` }
  for (const line of doc.lines) {
    // ทิศของบรรทัดเดิม: ใบรับ = เข้า · ใบเบิก = ออก · ใบปรับ = ตามเครื่องหมายส่วนต่าง → ชดเชยกลับทิศ
    const cameIn = doc.type === "RECEIPT" ? line.quantity : doc.type === "ISSUE" ? -line.quantity : line.quantity
    if (cameIn > 0) await takeStock(tx, storeId, line.productId, cameIn, link)
    if (cameIn < 0) await putStock(tx, storeId, line.productId, -cameIn, link)
  }
  return { docNumber: doc.docNumber, type: doc.type }
}
