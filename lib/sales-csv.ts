import type { SaleKind, SalesExportRow } from "@/lib/queries"
import { PAYMENT_METHOD_LABEL, type PaymentMethodValue } from "@/lib/types"
import { businessDayKey, formatHhMm, minuteOfBusinessDay } from "@/lib/day"

/// ไฟล์ CSV รายการขายทีละบรรทัด (20e ข้อ 8) — แยกออกจาก route เพื่อเทสได้โดยไม่ต้องยิง HTTP

export const SALE_KIND_LABEL: Record<SaleKind, string> = {
  FOOD: "อาหาร/เครื่องดื่ม",
  SERVICE: "นวด/สปา",
  PRODUCT: "สินค้าหน้าร้าน",
}

const CHANNEL_LABEL: Record<string, string> = {
  RETAIL_POS: "หน้าร้าน",
  MOBILE_ORDER: "โต๊ะ/ห้อง",
  TAKEAWAY: "กลับบ้าน",
}

const HEADER = ["วันที่", "เวลา", "เลขบิล", "ช่องทาง", "ประเภท", "รายการ", "จำนวน", "ราคาต่อหน่วย", "ยอด", "พนักงานนวด", "โต๊ะ/ห้อง", "วิธีชำระ"]

/// ครอบค่าตามกติกา CSV + กันสูตร Excel (ค่าขึ้นต้นด้วย = + - @ ถูกเติม ' ไว้หน้า) —
/// ชื่อเมนู/ลูกค้ามาจากผู้ใช้ เปิดใน Excel แล้วต้องไม่กลายเป็นสูตรที่รันได้
export function csvCell(value: string | number | null): string {
  if (value === null) return ""
  if (typeof value === "number") return String(value)
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/// ใส่ BOM นำหน้า ให้ Excel บน Windows อ่านภาษาไทยเป็น UTF-8 (ไม่งั้นเปิดมาเป็นตัวอักษรเพี้ยน)
export function buildSalesCsv(rows: SalesExportRow[]): string {
  const lines = [HEADER.map(csvCell).join(",")]
  for (const row of rows) {
    lines.push(
      [
        businessDayKey(row.soldAt),
        formatHhMm(minuteOfBusinessDay(row.soldAt)),
        row.saleNumber,
        CHANNEL_LABEL[row.channel] ?? row.channel,
        SALE_KIND_LABEL[row.kind],
        row.name,
        row.quantity,
        row.unitPrice.toFixed(2),
        row.subtotal.toFixed(2),
        row.therapistLabel,
        row.tableCode,
        PAYMENT_METHOD_LABEL[row.paymentMethod as PaymentMethodValue] ?? row.paymentMethod,
      ]
        .map((cell) => csvCell(cell))
        .join(","),
    )
  }
  return `﻿${lines.join("\r\n")}\r\n`
}
