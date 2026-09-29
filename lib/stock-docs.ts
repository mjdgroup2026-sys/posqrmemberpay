import type { StoreTx } from "@/lib/db"
import type { StockDocType } from "@/generated/prisma/client"
import { putStock, takeStock } from "@/lib/stock-moves"
import { dateOnlyFromKey } from "@/lib/day"
import type {
  ReceiveRoundInput,
  StockAdjustInput,
  StockIssueInput,
  StockReceiptEditInput,
  StockReceiptInput,
} from "@/lib/validation"

/// เอกสารคลัง รับ/เบิก/ปรับ (Phase 21) — ตรรกะที่เดียว ห้ามลอกไปเขียนใน action/หน้าอื่น
///
/// · ใบเบิก/ใบปรับบันทึกแล้วมีผลกับสต็อกทันที · ใบรับ (21d) เป็นร่างแล้วรับเป็นรอบ ๆ (ดูหัวข้อใบรับด้านล่าง)
/// · แต่ละบรรทัดขยับสต็อกผ่าน `lib/stock-moves.ts` ซึ่งเขียน ledger คู่กันเสมอ
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

// ───────────────────── ใบรับ: ร่าง + รับหลายรอบ (Phase 21d) ─────────────────────
//
// ใบรับ = รายการที่สั่งไว้ (แก้ได้ระหว่างยังค้างรับ) · สต็อกขยับเฉพาะตอน "รับ" แต่ละรอบ (`StockReceiptRound`)
// · ทุกคำสั่งที่เปลี่ยนยอดรับ/ยกเลิกของใบ ล็อกแถวหัวใบก่อน (`lockReceipt`) — สองคนกดรับพร้อมกันจะเข้าคิว
//   แล้วคนที่สองเห็นยอดค้างล่าสุด จึงรับเกินจำนวนสั่งไม่ได้ (CHECK ในฐานเป็นด่านสุดท้ายอีกชั้น)
// · สถานะของใบคำนวณจากยอดบรรทัดที่ `receiptStatusOf()` ที่เดียว ห้ามตั้งเองที่อื่น

export type ReceiptStatus = "DRAFT" | "PARTIAL" | "RECEIVED" | "CLOSED"

type ReceiptLineQty = { quantity: number; receivedQty: number; cancelledQty: number }

export function remainingOf(line: ReceiptLineQty): number {
  return Math.max(line.quantity - line.receivedQty - line.cancelledQty, 0)
}

/// ค้างรับ > 0 = ร่าง (ยังไม่ได้รับเลย) / รับบางส่วน · ค้าง 0 = รับครบ หรือ ปิดแล้ว (มียอดที่ยกเลิกไม่รับ)
export function receiptStatusOf(lines: ReceiptLineQty[]): ReceiptStatus {
  const remaining = lines.reduce((sum, line) => sum + remainingOf(line), 0)
  if (remaining > 0) return lines.some((line) => line.receivedQty > 0) ? "PARTIAL" : "DRAFT"
  return lines.some((line) => line.cancelledQty > 0) ? "CLOSED" : "RECEIVED"
}

const OPEN_STATUSES = new Set(["DRAFT", "PARTIAL"])

type LockedReceipt = { id: string; docNumber: string; status: string }

/// ล็อกแถวหัวใบรับ (`SELECT … FOR UPDATE`) — raw SQL กรอง storeId เอง · ใบของร้านอื่น/ไม่ใช่ใบรับ = ไม่พบ
async function lockReceipt(tx: StoreTx, storeId: string, documentId: string): Promise<LockedReceipt> {
  const rows = await tx.$queryRaw<LockedReceipt[]>`
    SELECT "id", "docNumber", "status"::text AS status FROM "stock_document"
    WHERE "id" = ${documentId} AND "storeId" = ${storeId} AND "type" = 'RECEIPT'
    FOR UPDATE
  `
  if (rows.length === 0) throw new StockDocError("ไม่พบใบรับสินค้านี้")
  return rows[0]
}

function assertOpen(doc: LockedReceipt, action: string) {
  if (OPEN_STATUSES.has(doc.status)) return
  const why = doc.status === "VOIDED" ? "ถูกยกเลิกแล้ว" : doc.status === "CLOSED" ? "ปิดแล้ว" : "รับครบแล้ว"
  throw new StockDocError(`${doc.docNumber} ${why} — ${action}ไม่ได้`)
}

function assertNotVoided(doc: LockedReceipt, action: string) {
  if (doc.status === "VOIDED") throw new StockDocError(`${doc.docNumber} ถูกยกเลิกแล้ว — ${action}ไม่ได้`)
}

/// คำนวณสถานะใหม่จากยอดบรรทัดแล้วเขียนลงหัวใบ — เรียกท้ายทุกคำสั่งที่แตะยอดรับ/ยกเลิก/จำนวนสั่ง (ใต้ล็อกเดียวกัน)
async function refreshReceiptStatus(tx: StoreTx, documentId: string): Promise<ReceiptStatus> {
  const lines = await tx.stockDocumentLine.findMany({
    where: { documentId },
    select: { quantity: true, receivedQty: true, cancelledQty: true },
  })
  const status = receiptStatusOf(lines)
  await tx.stockDocument.update({ where: { id: documentId }, data: { status } })
  return status
}

/// บรรทัดของใบรับ (FK จากฟอร์ม) — `StockDocumentLine` ไม่มี storeId จึงหาใบก่อนแล้วให้ `lockReceipt` ตรวจร้านอีกชั้น
async function findReceiptLine(tx: StoreTx, storeId: string, lineId: string) {
  const line = await tx.stockDocumentLine.findFirst({
    where: { id: lineId, document: { storeId, type: "RECEIPT" } },
    select: { id: true, documentId: true, quantity: true, receivedQty: true, cancelledQty: true, product: { select: { name: true, unit: true } } },
  })
  if (!line) throw new StockDocError("ไม่พบรายการนี้ในใบรับสินค้า")
  return line
}

type ReceiptLineInput = { productId: string; quantity: number; unitCost?: number }

function lineCost(line: ReceiptLineInput) {
  return {
    unitCost: line.unitCost === undefined ? null : line.unitCost.toFixed(2),
    lineTotal: line.unitCost === undefined ? null : round2(line.unitCost * line.quantity).toFixed(2),
  }
}

/// มูลค่ารวมของจำนวนที่สั่ง (เฉพาะบรรทัดที่กรอกราคาทุน) · ไม่มีบรรทัดไหนกรอก = null
function orderedTotal(lines: ReceiptLineInput[]): string | null {
  const costed = lines.filter((line) => line.unitCost !== undefined)
  if (costed.length === 0) return null
  return round2(costed.reduce((sum, line) => sum + (line.unitCost ?? 0) * line.quantity, 0)).toFixed(2)
}

/// สร้างใบรับเป็นร่าง — ยังไม่แตะสต็อก
export async function createReceiptDraft(tx: StoreTx, ctx: PostContext, input: StockReceiptInput): Promise<PostedDoc> {
  await loadProducts(tx, input.lines.map((line) => line.productId))
  const docNumber = await nextDocNumber(tx, ctx.storeId, "RECEIPT")
  return tx.stockDocument.create({
    data: {
      storeId: ctx.storeId,
      type: "RECEIPT",
      status: "DRAFT",
      docNumber,
      docDate: dateOnlyFromKey(ctx.docDateKey),
      supplierName: input.supplierName ?? null,
      referenceNo: input.referenceNo ?? null,
      note: input.note ?? null,
      totalCost: orderedTotal(input.lines),
      createdById: ctx.userId,
      lines: {
        create: input.lines.map((line, index) => ({
          lineNo: index + 1,
          productId: line.productId,
          quantity: line.quantity,
          ...lineCost(line),
        })),
      },
    },
    select: { id: true, docNumber: true },
  })
}

/// บันทึกแล้วรับครบทันที (ขั้นตอนเดิมก่อน 21d) = สร้างร่าง + รอบที่ 1 รับทุกบรรทัดเต็มจำนวน ในทรานแซคชันเดียว
export async function postReceipt(tx: StoreTx, ctx: PostContext, input: StockReceiptInput): Promise<PostedDoc> {
  const doc = await createReceiptDraft(tx, ctx, input)
  const lines = await tx.stockDocumentLine.findMany({ where: { documentId: doc.id }, select: { id: true, quantity: true } })
  await receiveRound(tx, ctx, {
    documentId: doc.id,
    receivedDate: ctx.docDateKey,
    referenceNo: input.referenceNo,
    note: undefined,
    lines: lines.map((line) => ({ lineId: line.id, quantity: line.quantity })),
  })
  return doc
}

/// แก้ใบรับที่ยังค้างรับ (ร่าง / รับบางส่วน)
/// · บรรทัดที่เคยมีรอบรับ (แม้รอบนั้นถูกยกเลิกแล้ว) ลบไม่ได้และเปลี่ยนสินค้าไม่ได้ — ประวัติรอบรับอ้างบรรทัดนี้อยู่
/// · จำนวนสั่งต้องไม่น้อยกว่า รับแล้ว + ยกเลิก
export async function updateReceipt(
  tx: StoreTx,
  ctx: PostContext,
  input: StockReceiptEditInput,
): Promise<PostedDoc & { status: ReceiptStatus }> {
  const doc = await lockReceipt(tx, ctx.storeId, input.id)
  assertOpen(doc, "แก้ไข")
  await loadProducts(tx, input.lines.map((line) => line.productId))

  const existing = await tx.stockDocumentLine.findMany({
    where: { documentId: doc.id },
    select: {
      id: true,
      productId: true,
      receivedQty: true,
      cancelledQty: true,
      product: { select: { name: true } },
      _count: { select: { roundLines: true } },
    },
  })
  const byId = new Map(existing.map((line) => [line.id, line]))
  const kept = new Set<string>()

  for (const line of input.lines) {
    if (!line.lineId) continue
    const old = byId.get(line.lineId)
    if (!old) throw new StockDocError("มีรายการที่ไม่อยู่ในใบรับนี้ — กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง")
    kept.add(old.id)
    if (old.productId !== line.productId && old._count.roundLines > 0) {
      throw new StockDocError(`${old.product.name} มีประวัติรับแล้ว — เปลี่ยนสินค้าไม่ได้`)
    }
    const floor = old.receivedQty + old.cancelledQty
    if (line.quantity < floor) {
      throw new StockDocError(`จำนวนสั่งของ ${old.product.name} ต้องไม่น้อยกว่า ${floor} (รับแล้ว ${old.receivedQty} · ยกเลิก ${old.cancelledQty})`)
    }
  }
  const removed = existing.filter((line) => !kept.has(line.id))
  const blocked = removed.find((line) => line._count.roundLines > 0)
  if (blocked) throw new StockDocError(`${blocked.product.name} มีประวัติรับแล้ว — ลบออกจากใบไม่ได้ (แก้จำนวนหรือยกเลิกยอดค้างแทน)`)

  if (removed.length > 0) await tx.stockDocumentLine.deleteMany({ where: { id: { in: removed.map((line) => line.id) } } })
  for (const [index, line] of input.lines.entries()) {
    const data = { lineNo: index + 1, productId: line.productId, quantity: line.quantity, ...lineCost(line) }
    if (line.lineId) await tx.stockDocumentLine.update({ where: { id: line.lineId }, data })
    else await tx.stockDocumentLine.create({ data: { ...data, documentId: doc.id } })
  }

  await tx.stockDocument.update({
    where: { id: doc.id },
    data: {
      docDate: dateOnlyFromKey(ctx.docDateKey),
      supplierName: input.supplierName ?? null,
      referenceNo: input.referenceNo ?? null,
      note: input.note ?? null,
      totalCost: orderedTotal(input.lines),
    },
  })
  const status = await refreshReceiptStatus(tx, doc.id)
  return { id: doc.id, docNumber: doc.docNumber, status }
}

/// รับสินค้า 1 รอบ — บรรทัดละไม่เกินยอดค้าง · สต็อกเพิ่มเฉพาะที่รับรอบนี้ (ledger ผูกทั้งใบและรอบ)
export async function receiveRound(
  tx: StoreTx,
  ctx: { storeId: string; userId: string },
  input: ReceiveRoundInput,
): Promise<{ docNumber: string; roundNo: number; lineCount: number; status: ReceiptStatus }> {
  const doc = await lockReceipt(tx, ctx.storeId, input.documentId)
  assertOpen(doc, "รับสินค้า")

  const lines = await tx.stockDocumentLine.findMany({
    where: { documentId: doc.id },
    select: { id: true, productId: true, quantity: true, receivedQty: true, cancelledQty: true, product: { select: { name: true, unit: true } } },
  })
  const byId = new Map(lines.map((line) => [line.id, line]))
  const receiving = input.lines.filter((line) => line.quantity > 0)
  for (const line of receiving) {
    const current = byId.get(line.lineId)
    if (!current) throw new StockDocError("มีรายการที่ไม่อยู่ในใบรับนี้ — กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง")
    const remaining = remainingOf(current)
    if (line.quantity > remaining) {
      throw new StockDocError(
        remaining === 0
          ? `${current.product.name} ไม่มียอดค้างรับแล้ว`
          : `${current.product.name} รับได้อีกไม่เกิน ${remaining} ${current.product.unit} — ถ้าได้ของมาเกิน ให้แก้จำนวนสั่งก่อน`,
      )
    }
  }

  const last = await tx.stockReceiptRound.aggregate({ where: { documentId: doc.id }, _max: { roundNo: true } })
  const roundNo = (last._max.roundNo ?? 0) + 1
  const round = await tx.stockReceiptRound.create({
    data: {
      storeId: ctx.storeId,
      documentId: doc.id,
      roundNo,
      receivedDate: dateOnlyFromKey(input.receivedDate),
      referenceNo: input.referenceNo ?? null,
      note: input.note ?? null,
      createdById: ctx.userId,
    },
    select: { id: true },
  })

  const note = `${doc.docNumber} รอบที่ ${roundNo}${input.referenceNo ? ` · ใบส่งของ ${input.referenceNo}` : ""}`
  // เรียงตาม productId เสมอ (กติกาข้อ 2) — กันสองทรานแซคชันล็อกแถวสินค้าสลับลำดับกัน
  const ordered = [...receiving].sort((a, b) => ((byId.get(a.lineId)?.productId ?? "") < (byId.get(b.lineId)?.productId ?? "") ? -1 : 1))
  for (const line of ordered) {
    const current = byId.get(line.lineId)
    if (!current) continue
    await tx.stockReceiptRoundLine.create({
      data: { roundId: round.id, documentLineId: current.id, productId: current.productId, quantity: line.quantity },
    })
    await tx.stockDocumentLine.update({ where: { id: current.id }, data: { receivedQty: { increment: line.quantity } } })
    await putStock(tx, ctx.storeId, current.productId, line.quantity, { documentId: doc.id, receiptRoundId: round.id, note })
  }

  const status = await refreshReceiptStatus(tx, doc.id)
  return { docNumber: doc.docNumber, roundNo, lineCount: receiving.length, status }
}

/// รับสินค้า 1 รอบโดยระบุจำนวนต่อ "สินค้า" (ฟอร์มตารางเดียว — บรรทัดใหม่ที่เพิ่งสร้างในทรานแซคชันเดียวกันยังไม่มี lineId ฝั่ง client)
/// สินค้าไม่ซ้ำในใบ (zod บังคับ) จึงแปลง productId → lineId ได้ตรงตัว · จำนวน 0 = ไม่รับบรรทัดนั้นรอบนี้
/// ค้างรับเหลือ = ใบยังเปิด (รับบางส่วน) กลับมารับรอบถัดไปได้ · ใบปิดเองเมื่อค้าง 0 เท่านั้น
export async function receiveByProduct(
  tx: StoreTx,
  ctx: { storeId: string; userId: string },
  documentId: string,
  round: { receivedDate: string; referenceNo?: string; note?: string },
  quantities: { productId: string; quantity: number }[],
): Promise<Awaited<ReturnType<typeof receiveRound>>> {
  const lines = await tx.stockDocumentLine.findMany({ where: { documentId }, select: { id: true, productId: true } })
  const lineOf = new Map(lines.map((line) => [line.productId, line.id]))
  const receiving = quantities
    .filter((entry) => entry.quantity > 0)
    .map((entry) => {
      const lineId = lineOf.get(entry.productId)
      if (!lineId) throw new StockDocError("มีรายการที่ไม่อยู่ในใบรับนี้ — กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง")
      return { lineId, quantity: entry.quantity }
    })
  if (receiving.length === 0) throw new StockDocError("กรุณากรอกจำนวน \"รับครั้งนี้\" อย่างน้อย 1 รายการ")
  return receiveRound(tx, ctx, {
    documentId,
    receivedDate: round.receivedDate,
    referenceNo: round.referenceNo,
    note: round.note,
    lines: receiving,
  })
}

/// ยกเลิกรอบรับ (หนึ่งหรือหลายรอบของใบเดียว) — ตัดของออกจากสต็อกด้วยรายการชดเชย + ถอยยอดรับของบรรทัด
/// · conditional update `status: POSTED` กันกดยกเลิกรอบเดียวกันซ้ำ · ตัดทุกบรรทัดของทุกรอบเรียงตาม productId รวดเดียว (กัน deadlock)
async function reverseRounds(
  tx: StoreTx,
  storeId: string,
  userId: string,
  doc: LockedReceipt,
  rounds: { id: string; roundNo: number }[],
  reason: string,
): Promise<void> {
  for (const round of rounds) {
    const marked = await tx.stockReceiptRound.updateMany({
      where: { id: round.id, status: "POSTED" },
      data: { status: "VOIDED", voidedAt: new Date(), voidedById: userId, voidReason: reason },
    })
    if (marked.count === 0) throw new StockDocError(`${doc.docNumber} รอบที่ ${round.roundNo} ถูกยกเลิกไปแล้ว`)
  }

  const roundNoOf = new Map(rounds.map((round) => [round.id, round.roundNo]))
  const lines = await tx.stockReceiptRoundLine.findMany({
    where: { roundId: { in: rounds.map((round) => round.id) } },
    select: { roundId: true, documentLineId: true, productId: true, quantity: true },
    orderBy: [{ productId: "asc" }, { roundId: "asc" }],
  })
  for (const line of lines) {
    // ของที่รับเข้าถูกขาย/เบิกไปแล้วจนเหลือไม่พอ = StockShortage → rollback ทั้งคำสั่ง
    await takeStock(tx, storeId, line.productId, line.quantity, {
      documentId: doc.id,
      receiptRoundId: line.roundId,
      note: `ยกเลิก ${doc.docNumber} รอบที่ ${roundNoOf.get(line.roundId)} — ${reason}`,
    })
    await tx.stockDocumentLine.update({ where: { id: line.documentLineId }, data: { receivedQty: { decrement: line.quantity } } })
  }
}

/// ยกเลิกรอบรับ 1 รอบ — ใบกลับไปค้างรับตามยอดที่ถอย (ใบที่ปิดแล้วก็ยกเลิกรอบได้ ยกเว้นใบที่ถูกยกเลิกทั้งใบ)
export async function voidReceiptRound(
  tx: StoreTx,
  storeId: string,
  userId: string,
  roundId: string,
  reason: string,
): Promise<{ docNumber: string; roundNo: number; status: ReceiptStatus }> {
  // forStore กรอง storeId ให้ — รอบของร้านอื่นได้ null
  const round = await tx.stockReceiptRound.findUnique({ where: { id: roundId }, select: { id: true, roundNo: true, documentId: true } })
  if (!round) throw new StockDocError("ไม่พบรอบรับนี้")
  const doc = await lockReceipt(tx, storeId, round.documentId)
  assertNotVoided(doc, "ยกเลิกรอบรับ")
  await reverseRounds(tx, storeId, userId, doc, [round], reason)
  const status = await refreshReceiptStatus(tx, doc.id)
  return { docNumber: doc.docNumber, roundNo: round.roundNo, status }
}

/// ยกเลิกยอดค้างของบรรทัด (ผู้ขายไม่มีของ) — สต็อกไม่เปลี่ยนเพราะของยังไม่เคยเข้า
export async function cancelLineRemaining(
  tx: StoreTx,
  storeId: string,
  input: { lineId: string; quantity: number; reason: string },
): Promise<{ docNumber: string; productName: string; status: ReceiptStatus }> {
  const found = await findReceiptLine(tx, storeId, input.lineId)
  const doc = await lockReceipt(tx, storeId, found.documentId)
  assertNotVoided(doc, "ยกเลิกยอดค้าง")
  // อ่านซ้ำหลังได้ล็อก — ยอดก่อนล็อกอาจเก่าแล้ว
  const line = await findReceiptLine(tx, storeId, input.lineId)
  const remaining = remainingOf(line)
  if (remaining === 0) throw new StockDocError(`${line.product.name} ไม่มียอดค้างรับแล้ว`)
  if (input.quantity > remaining) throw new StockDocError(`${line.product.name} ยกเลิกได้ไม่เกินยอดค้าง ${remaining} ${line.product.unit}`)

  await tx.stockDocumentLine.update({
    where: { id: line.id },
    data: { cancelledQty: { increment: input.quantity }, cancelReason: input.reason },
  })
  const status = await refreshReceiptStatus(tx, doc.id)
  return { docNumber: doc.docNumber, productName: line.product.name, status }
}

/// คืนยอดค้างที่ยกเลิกไว้ทั้งหมดของบรรทัด (ผู้ขายกลับมาส่งได้) — ใบที่ปิดไปแล้วกลับมาค้างรับอีกครั้ง
export async function restoreLineRemaining(
  tx: StoreTx,
  storeId: string,
  lineId: string,
): Promise<{ docNumber: string; productName: string; restored: number; status: ReceiptStatus }> {
  const found = await findReceiptLine(tx, storeId, lineId)
  const doc = await lockReceipt(tx, storeId, found.documentId)
  assertNotVoided(doc, "คืนยอดค้าง")
  const line = await findReceiptLine(tx, storeId, lineId)
  if (line.cancelledQty === 0) throw new StockDocError(`${line.product.name} ไม่มียอดที่ยกเลิกไว้`)

  await tx.stockDocumentLine.update({ where: { id: line.id }, data: { cancelledQty: 0, cancelReason: null } })
  const status = await refreshReceiptStatus(tx, doc.id)
  return { docNumber: doc.docNumber, productName: line.product.name, restored: line.cancelledQty, status }
}

/// ปิดใบ = ยกเลิกยอดค้างของทุกบรรทัดที่ยังค้างในครั้งเดียว
export async function closeReceipt(
  tx: StoreTx,
  storeId: string,
  documentId: string,
  reason: string,
): Promise<{ docNumber: string; cancelled: number; status: ReceiptStatus }> {
  const doc = await lockReceipt(tx, storeId, documentId)
  assertOpen(doc, "ปิดใบ")
  const lines = await tx.stockDocumentLine.findMany({
    where: { documentId: doc.id },
    select: { id: true, quantity: true, receivedQty: true, cancelledQty: true },
  })
  let cancelled = 0
  for (const line of lines) {
    const remaining = remainingOf(line)
    if (remaining === 0) continue
    await tx.stockDocumentLine.update({ where: { id: line.id }, data: { cancelledQty: { increment: remaining }, cancelReason: reason } })
    cancelled += 1
  }
  const status = await refreshReceiptStatus(tx, doc.id)
  return { docNumber: doc.docNumber, cancelled, status }
}

/// ยกเลิกใบรับทั้งใบ — ยกเลิกทุกรอบที่ยังไม่ยกเลิก (ของรอบไหนถูกขายไปจนไม่พอ = ไม่ยกเลิกเลยทั้งใบ)
async function voidReceipt(tx: StoreTx, storeId: string, userId: string, documentId: string, reason: string) {
  const doc = await lockReceipt(tx, storeId, documentId)
  if (doc.status === "VOIDED") throw new StockDocError(`${doc.docNumber} ถูกยกเลิกไปแล้ว`)
  const rounds = await tx.stockReceiptRound.findMany({
    where: { documentId: doc.id, status: "POSTED" },
    select: { id: true, roundNo: true },
    orderBy: { roundNo: "asc" },
  })
  if (rounds.length > 0) await reverseRounds(tx, storeId, userId, doc, rounds, reason)
  await tx.stockDocument.update({
    where: { id: doc.id },
    data: { status: "VOIDED", voidedAt: new Date(), voidedById: userId, voidReason: reason },
  })
  return { docNumber: doc.docNumber, type: "RECEIPT" as const }
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
/// · ใบรับ: ยกเลิกทุกรอบที่รับแล้ว (`voidReceipt` — ถ้าขาย/เบิกไปแล้วจนเหลือไม่พอ = ปฏิเสธทั้งใบ) · ใบเบิก: คืนเข้า · ใบปรับ: กลับทิศส่วนต่าง
export async function voidStockDocument(
  tx: StoreTx,
  storeId: string,
  userId: string,
  documentId: string,
  reason: string,
): Promise<{ docNumber: string; type: StockDocType }> {
  const head = await tx.stockDocument.findUnique({ where: { id: documentId }, select: { type: true } })
  if (!head) throw new StockDocError("ไม่พบเอกสารนี้")
  // ใบรับ (21d) ยกเลิกเป็นรายรอบ — ทางของตัวเองที่ล็อกหัวใบก่อน
  if (head.type === "RECEIPT") return voidReceipt(tx, storeId, userId, documentId, reason)

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
