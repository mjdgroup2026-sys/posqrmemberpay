"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { getCurrentPermissions, guardAction, type ResourceKey } from "@/lib/permissions"
import { parseBusinessDayKey } from "@/lib/day"
import { StockMissing, StockShortage } from "@/lib/stock-moves"
import {
  DOC_TYPE_LABEL,
  postAdjustment,
  postIssue,
  postReceipt,
  StockDocError,
  voidStockDocument,
} from "@/lib/stock-docs"
import {
  firstIssueMessage,
  parseCartJson,
  stockAdjustSchema,
  stockIssueSchema,
  stockReceiptSchema,
  voidStockDocSchema,
  zodToFieldErrors,
} from "@/lib/validation"
import type { StockDocType } from "@/generated/prisma/client"
import type { ActionResult } from "@/lib/types"

/// เอกสารคลัง รับ/เบิก/ปรับ (Phase 21 · F30) — แทน `stockIn`/`stockOut` ทีละรายการเดิม
/// ตรรกะทั้งหมดอยู่ที่ `lib/stock-docs.ts` · ไฟล์นี้ทำแค่ ด่านสิทธิ์ → ตรวจฟอร์ม → เรียก lib ในทรานแซคชัน → แปลข้อผิดพลาดเป็นไทย

/// resource ที่คุมเอกสารแต่ละประเภท — ใบรับ/ใบเบิกใช้สิทธิ์เดิมของหน้ารับเข้า/เบิกจ่าย · ใบปรับมี resource ของตัวเอง
const DOC_RESOURCE: Record<StockDocType, ResourceKey> = {
  RECEIPT: "STOCK_IN",
  ISSUE: "STOCK_OUT",
  ADJUST: "STOCK_ADJUST",
}

export type StockDocResult = { id: string; docNumber: string }

function revalidateStockPages() {
  revalidatePath("/")
  revalidatePath("/products")
  revalidatePath("/stock/receipts")
  revalidatePath("/stock/issues")
  revalidatePath("/stock/adjustments")
  revalidatePath("/reports")
  revalidatePath("/reports/stock-sales")
  revalidatePath("/reports/reorder")
}

/// ข้อผิดพลาดที่รู้จัก → ข้อความไทย · ไม่รู้จัก = ข้อความกลาง (ห้ามโยนข้อความอังกฤษดิบให้ผู้ใช้ — กติกาข้อ 6)
function stockDocErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof StockDocError) return error.reason
  if (error instanceof StockShortage) return `สต็อก${error.reason} — ไม่ได้บันทึกเอกสารนี้`
  if (error instanceof StockMissing) return "มีสินค้าบางรายการไม่พบในร้านนี้ — กรุณาเลือกสินค้าใหม่"
  return fallback
}

function readDocDate(formData: FormData): unknown {
  return formData.get("docDate") ?? ""
}

/// วันที่เอกสารย้อนหลังได้ แต่ห้ามอนาคต (รับของล่วงหน้าไม่มีจริง) — ใช้กติกาเดียวกับเลือกวันปิดรอบ
function checkDocDate(key: string): string | null {
  return parseBusinessDayKey(key) ? null : "วันที่เอกสารต้องไม่เป็นวันในอนาคต"
}

export async function createStockReceipt(formData: FormData): Promise<ActionResult<StockDocResult>> {
  const guard = await guardAction("STOCK_IN", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const { storeId, id: userId } = guard.user

  const parsed = stockReceiptSchema.safeParse({
    docDate: readDocDate(formData),
    supplierName: formData.get("supplierName") ?? undefined,
    referenceNo: formData.get("referenceNo") ?? undefined,
    note: formData.get("note") ?? undefined,
    lines: parseCartJson(formData.get("lines")),
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const dateError = checkDocDate(parsed.data.docDate)
  if (dateError) return { ok: false, error: dateError, fieldErrors: { docDate: dateError } }

  try {
    const doc = await forStore(storeId).$transaction((tx) =>
      postReceipt(tx, { storeId, userId, docDateKey: parsed.data.docDate }, parsed.data),
    )
    revalidateStockPages()
    return { ok: true, message: `บันทึก${DOC_TYPE_LABEL.RECEIPT} ${doc.docNumber} แล้ว — เพิ่มสต็อก ${parsed.data.lines.length} รายการ`, data: doc }
  } catch (error) {
    return { ok: false, error: stockDocErrorMessage(error, "บันทึกใบรับสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง") }
  }
}

export async function createStockIssue(formData: FormData): Promise<ActionResult<StockDocResult>> {
  const guard = await guardAction("STOCK_OUT", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const { storeId, id: userId } = guard.user

  const parsed = stockIssueSchema.safeParse({
    docDate: readDocDate(formData),
    requesterName: formData.get("requesterName") ?? "",
    note: formData.get("note") ?? undefined,
    lines: parseCartJson(formData.get("lines")),
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const dateError = checkDocDate(parsed.data.docDate)
  if (dateError) return { ok: false, error: dateError, fieldErrors: { docDate: dateError } }

  try {
    const doc = await forStore(storeId).$transaction((tx) =>
      postIssue(tx, { storeId, userId, docDateKey: parsed.data.docDate }, parsed.data),
    )
    revalidateStockPages()
    return { ok: true, message: `บันทึก${DOC_TYPE_LABEL.ISSUE} ${doc.docNumber} แล้ว — ผู้เบิก ${parsed.data.requesterName}`, data: doc }
  } catch (error) {
    return { ok: false, error: stockDocErrorMessage(error, "บันทึกใบเบิกสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง") }
  }
}

export async function createStockAdjustment(formData: FormData): Promise<ActionResult<StockDocResult>> {
  const guard = await guardAction("STOCK_ADJUST", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const { storeId, id: userId } = guard.user

  const parsed = stockAdjustSchema.safeParse({
    docDate: readDocDate(formData),
    reason: formData.get("reason") ?? "",
    note: formData.get("note") ?? undefined,
    lines: parseCartJson(formData.get("lines")),
  })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }
  const dateError = checkDocDate(parsed.data.docDate)
  if (dateError) return { ok: false, error: dateError, fieldErrors: { docDate: dateError } }

  try {
    const doc = await forStore(storeId).$transaction((tx) =>
      postAdjustment(tx, { storeId, userId, docDateKey: parsed.data.docDate }, parsed.data),
    )
    revalidateStockPages()
    const summary = doc.changed === 0 ? "ยอดตรงกับระบบทุกรายการ" : `ปรับยอด ${doc.changed} รายการ`
    return { ok: true, message: `บันทึก${DOC_TYPE_LABEL.ADJUST} ${doc.docNumber} แล้ว — ${summary}`, data: { id: doc.id, docNumber: doc.docNumber } }
  } catch (error) {
    return { ok: false, error: stockDocErrorMessage(error, "บันทึกใบปรับยอดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง") }
  }
}

/// ยกเลิกเอกสาร — สิทธิ์ขึ้นกับประเภทของเอกสาร (DELETE ของ resource นั้น) จึงต้องอ่านประเภทก่อนตัดสิน
export async function voidStockDoc(formData: FormData): Promise<ActionResult> {
  const permissions = await getCurrentPermissions()
  if (!permissions) return { ok: false, error: "กรุณาเข้าสู่ระบบก่อนทำรายการ" }
  const { storeId, id: userId } = permissions
  const db = forStore(storeId)

  const parsed = voidStockDocSchema.safeParse({ id: formData.get("id") ?? "", reason: formData.get("reason") ?? "" })
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error), fieldErrors: zodToFieldErrors(parsed.error) }
  }

  // forStore กรอง storeId ให้ — id ของเอกสารร้านอื่นได้ null
  const doc = await db.stockDocument.findUnique({ where: { id: parsed.data.id }, select: { type: true } })
  if (!doc) return { ok: false, error: "ไม่พบเอกสารนี้" }
  const resource = DOC_RESOURCE[doc.type]
  const guard = await guardAction(resource, "DELETE")
  if (!guard.ok) return { ok: false, error: guard.error }

  try {
    const result = await db.$transaction((tx) => voidStockDocument(tx, storeId, userId, parsed.data.id, parsed.data.reason))
    revalidateStockPages()
    return { ok: true, message: `ยกเลิก${DOC_TYPE_LABEL[result.type]} ${result.docNumber} แล้ว — สร้างรายการชดเชยสต็อกเรียบร้อย` }
  } catch (error) {
    if (error instanceof StockShortage) {
      return { ok: false, error: `ยกเลิกไม่ได้ — ${error.reason} (ของที่รับเข้าถูกขาย/เบิกไปแล้ว)` }
    }
    return { ok: false, error: stockDocErrorMessage(error, "ยกเลิกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง") }
  }
}
