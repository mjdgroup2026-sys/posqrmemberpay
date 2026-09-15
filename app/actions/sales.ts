"use server"

import { revalidatePath } from "next/cache"
import { forStore } from "@/lib/db"
import { nextSaleNumber } from "@/lib/sale-number"
import { guardAction } from "@/lib/permissions"
import { toNumber } from "@/lib/format"
import { businessDateOnly, isSameBusinessDay } from "@/lib/day"
import {
  saleSchema,
  voidSaleSchema,
  parseCartJson,
  firstIssueMessage,
  zodToFieldErrors,
} from "@/lib/validation"
import type { ActionResult, FieldErrors, ReceiptData, ReceiptLine } from "@/lib/types"


function revalidateSalePages() {
  revalidatePath("/")
  revalidatePath("/pos")
  revalidatePath("/pos/history")
  revalidatePath("/pos/closing")
  revalidatePath("/products")
  revalidatePath("/reports")
}

/// ยกเลิกทั้งทรานแซคชันพร้อมข้อความไทยที่พร้อมส่งให้ผู้ใช้
class SaleAbort extends Error {
  constructor(readonly failure: { error: string; fieldErrors?: FieldErrors }) {
    super("SALE_ABORT")
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function createSale(formData: FormData): Promise<ActionResult<ReceiptData>> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ POS:ADD ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("POS", "ADD")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)
  const user = guard.user

  const parsed = saleSchema.safeParse({
    items: parseCartJson(formData.get("items")),
    discount: formData.get("discount") ?? 0,
    paymentMethod: formData.get("paymentMethod") ?? "",
    amountReceived: formData.get("amountReceived") ?? 0,
    note: formData.get("note") ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { discount, paymentMethod, amountReceived, note } = parsed.data

  // รวมบรรทัดที่เป็นสินค้าเดียวกัน แล้วเรียงตาม productId — เรียงให้ทุกทรานแซคชัน
  // ล็อกแถวสินค้าในลำดับเดียวกันเสมอ ลดโอกาส deadlock ตอนขายพร้อมกันหลายเครื่อง
  const merged = new Map<string, number>()
  for (const item of parsed.data.items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity)
  }
  const lines = Array.from(merged, ([productId, quantity]) => ({ productId, quantity })).sort((a, b) =>
    a.productId.localeCompare(b.productId),
  )

  // เลขบิลชนกันได้ถ้ามีคนกดชำระพร้อมกัน — เจอ P2002 แล้ว retry ทั้งทรานแซคชันใหม่
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const receipt = await db.$transaction(async (tx) => {
        const products = await tx.product.findMany({
          where: { id: { in: lines.map((l) => l.productId) } },
          select: { id: true, sku: true, name: true, unit: true, price: true },
        })
        if (products.length !== lines.length) {
          throw new SaleAbort({ error: "มีสินค้าบางรายการไม่อยู่ในระบบแล้ว กรุณาตรวจสอบตะกร้าอีกครั้ง" })
        }
        const byId = new Map(products.map((p) => [p.id, p]))

        const items: ReceiptLine[] = lines.map((line) => {
          const product = byId.get(line.productId)
          if (!product) throw new SaleAbort({ error: "มีสินค้าบางรายการไม่อยู่ในระบบแล้ว" })
          const unitPrice = toNumber(product.price)
          return {
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unit: product.unit,
            quantity: line.quantity,
            unitPrice,
            subtotal: round2(unitPrice * line.quantity),
          }
        })

        const subtotal = round2(items.reduce((sum, i) => sum + i.subtotal, 0))
        if (discount > subtotal) {
          throw new SaleAbort({
            error: `ส่วนลดเกินยอดรวมของบิล — ยอดรวมคือ ${subtotal.toFixed(2)} บาท`,
            fieldErrors: { discount: "ส่วนลดต้องไม่เกินยอดรวม" },
          })
        }

        const total = round2(subtotal - discount)
        if (paymentMethod === "CASH" && amountReceived < total) {
          throw new SaleAbort({
            error: `เงินที่รับไม่พอ — ต้องชำระ ${total.toFixed(2)} บาท`,
            fieldErrors: { amountReceived: "จำนวนเงินที่รับต้องไม่น้อยกว่ายอดสุทธิ" },
          })
        }

        // โอน/QR ไม่มีการรับเงินสดเกิน — บังคับให้ตรงยอดเสมอ ไม่เชื่อค่าที่ client ส่งมา
        const received = paymentMethod === "CASH" ? round2(amountReceived) : total
        const changeDue = paymentMethod === "CASH" ? round2(received - total) : 0

        const saleNumber = await nextSaleNumber(tx, storeId)

        const sale = await tx.sale.create({
          data: {
            storeId,
            saleNumber,
            subtotal: subtotal.toFixed(2),
            discount: discount.toFixed(2),
            total: total.toFixed(2),
            paymentMethod,
            amountReceived: received.toFixed(2),
            changeDue: changeDue.toFixed(2),
            note,
            cashierId: user.id,
          },
          select: { id: true, saleNumber: true, createdAt: true },
        })

        for (const item of items) {
          // ★ ด่านกันขายเกินสต็อก: updateMany + where quantity gte เป็นด่านเดียวที่กัน race
          //   condition ได้จริง (กติกาข้อ 4) — ล้มบรรทัดไหนก็ rollback ทั้งบิล ไม่ตัดสต็อกบางส่วน
          const updated = await tx.product.updateMany({
            where: { id: item.productId, quantity: { gte: item.quantity } },
            data: { quantity: { decrement: item.quantity } },
          })
          if (updated.count === 0) {
            const current = await tx.product.findUnique({
              where: { id: item.productId },
              select: { quantity: true },
            })
            throw new SaleAbort({
              error: `สต็อก ${item.name} ไม่พอขาย — ขาย ${item.quantity} ${item.unit} แต่มีอยู่ ${current?.quantity ?? 0} ${item.unit}`,
            })
          }

          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: item.productId,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toFixed(2),
              subtotal: item.subtotal.toFixed(2),
            },
          })

          await tx.stockTransaction.create({
            data: {
              storeId,
              productId: item.productId,
              type: "OUT",
              quantity: item.quantity,
              saleId: sale.id,
              note: `ขายหน้าร้าน ${sale.saleNumber}`,
            },
          })
        }

        const data: ReceiptData = {
          id: sale.id,
          saleNumber: sale.saleNumber,
          createdAt: sale.createdAt.toISOString(),
          cashierName: user.name,
          items,
          subtotal,
          discount,
          total,
          paymentMethod,
          amountReceived: received,
          changeDue,
          note,
        }
        return data
      })

      revalidateSalePages()
      return {
        ok: true,
        message: `ขายสำเร็จ — บิล ${receipt.saleNumber} ยอดสุทธิ ${receipt.total.toFixed(2)} บาท`,
        data: receipt,
      }
    } catch (error) {
      if (error instanceof SaleAbort) return { ok: false, ...error.failure }
      // เลขบิลชนกัน — วนไปออกเลขใหม่ (สต็อกถูก rollback ไปทั้งหมดแล้ว)
      if ((error as { code?: string }).code === "P2002") continue
      return { ok: false, error: "บันทึกการขายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
    }
  }

  return { ok: false, error: "ออกเลขที่บิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
}

export async function voidSale(formData: FormData): Promise<ActionResult> {
  // ด่านชั้นที่ 2 ของ §4 — เช็คสิทธิ์ POS_HISTORY:DELETE ก่อนแตะข้อมูลเสมอ
  // ห้ามพึ่งปุ่มที่ซ่อนไว้ฝั่ง client เพราะ Server Action ถูกเรียกตรงได้
  const guard = await guardAction("POS_HISTORY", "DELETE")
  if (!guard.ok) return { ok: false, error: guard.error }
  const storeId = guard.user.storeId
  const db = forStore(storeId)
  const user = guard.user

  const parsed = voidSaleSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: firstIssueMessage(parsed.error),
      fieldErrors: zodToFieldErrors(parsed.error),
    }
  }

  const { id, reason } = parsed.data

  try {
    const saleNumber = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        select: {
          id: true,
          saleNumber: true,
          status: true,
          createdAt: true,
          cashierId: true,
          items: { select: { productId: true, quantity: true } },
        },
      })
      if (!sale) throw new SaleAbort({ error: "ไม่พบบิลที่ต้องการยกเลิก" })
      if (sale.status === "VOIDED") throw new SaleAbort({ error: `บิล ${sale.saleNumber} ถูกยกเลิกไปแล้ว` })
      if (!isSameBusinessDay(sale.createdAt, new Date())) {
        throw new SaleAbort({
          error: `ยกเลิกได้เฉพาะบิลที่ขายในวันเดียวกันเท่านั้น — บิล ${sale.saleNumber} ข้ามวันไปแล้ว`,
        })
      }

      // ปิดยอดของแคชเชียร์คนนั้นในวันนั้นไปแล้ว ห้าม void ซ้ำ ไม่งั้นตัวเลขที่ปิดไปแล้วคลาดเคลื่อน
      const closed = await tx.cashierClosing.findUnique({
        where: {
          storeId_cashierId_closingDate: {
            storeId,
            cashierId: sale.cashierId,
            closingDate: businessDateOnly(sale.createdAt),
          },
        },
        select: { id: true },
      })
      if (closed) {
        throw new SaleAbort({ error: `ปิดยอดของวันนี้ไปแล้ว จึงยกเลิกบิล ${sale.saleNumber} ไม่ได้` })
      }

      // ★ conditional update — กัน race กับผู้ใช้อีกคนที่กด void บิลเดียวกันพร้อมกัน
      const marked = await tx.sale.updateMany({
        where: { id: sale.id, status: "COMPLETED" },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidedById: user.id,
          voidReason: reason,
        },
      })
      if (marked.count === 0) throw new SaleAbort({ error: `บิล ${sale.saleNumber} ถูกยกเลิกไปแล้ว` })

      // คืนสต็อกด้วยรายการชดเชย — ห้ามลบ/แก้ StockTransaction(OUT) เดิม (ledger append-only)
      for (const item of sale.items) {
        // บรรทัดที่มาจาก MJD Mobile Order อ้าง MenuItem ไม่ใช่ Product จึงไม่มีสต็อกให้คืน (Phase 10)
        if (!item.productId) continue

        await tx.product.update({
          where: { id: item.productId },
          data: { quantity: { increment: item.quantity } },
        })
        await tx.stockTransaction.create({
          data: {
            storeId,
            productId: item.productId,
            type: "IN",
            quantity: item.quantity,
            saleId: sale.id,
            note: `ยกเลิกบิล ${sale.saleNumber}`,
          },
        })
      }

      return sale.saleNumber
    })

    revalidateSalePages()
    return { ok: true, message: `ยกเลิกบิล ${saleNumber} และคืนสต็อกเรียบร้อยแล้ว` }
  } catch (error) {
    if (error instanceof SaleAbort) return { ok: false, ...error.failure }
    return { ok: false, error: "ยกเลิกบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }
  }
}
