"use client"

import { formatBaht, formatDateTime, formatNumber } from "@/lib/format"
import { PAYMENT_METHOD_LABEL, type ReceiptData } from "@/lib/types"

/// ใบเสร็จบนหน้าจอ + เป็นตัวที่ถูกพิมพ์จริงตอนกด window.print()
/// (กติกาการพิมพ์อยู่ใน @media print ของ app/globals.css — ซ่อนทุกอย่างยกเว้น .receipt-print)
export function Receipt({ data, storeName = "MJD Mobile Order" }: { data: ReceiptData; storeName?: string }) {
  return (
    <div className="receipt-print">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <p style={{ fontWeight: 700, fontSize: "1.05rem" }}>{storeName}</p>
        <p className="t-caption">ใบเสร็จรับเงิน / ใบกำกับอย่างย่อ</p>
      </div>

      <div className="t-small" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>เลขที่บิล</span>
          <span className="num" style={{ fontWeight: 600 }}>
            {data.saleNumber}
          </span>
        </span>
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>วันที่</span>
          <span className="num">{formatDateTime(data.createdAt)}</span>
        </span>
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>พนักงานขาย</span>
          <span>{data.cashierName}</span>
        </span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", margin: "12px 0", fontSize: "0.875rem" }}>
        <thead>
          <tr style={{ borderBottom: "1px dashed var(--line)", textAlign: "left" }}>
            <th style={{ padding: "6px 0", fontWeight: 500 }}>รายการ</th>
            <th style={{ padding: "6px 0", fontWeight: 500, textAlign: "right" }}>จำนวน</th>
            <th style={{ padding: "6px 0", fontWeight: 500, textAlign: "right" }}>รวม</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.productId} style={{ borderBottom: "1px dashed var(--line)" }}>
              <td style={{ padding: "6px 0" }}>
                {item.name}
                {item.therapistLabel ? <span className="t-caption"> · พนง. {item.therapistLabel}</span> : null}
                <br />
                <span className="t-caption num">
                  {/* บิลอาหาร (Phase 17c) ไม่มี SKU/หน่วยนับ — โชว์เฉพาะราคาต่อหน่วย */}
                  {item.sku ? `${item.sku} · ` : ""}฿{formatBaht(item.unitPrice)}
                  {item.unit ? `/${item.unit}` : ""}
                </span>
              </td>
              <td className="num" style={{ padding: "6px 0", textAlign: "right", verticalAlign: "top" }}>
                {formatNumber(item.quantity)}
              </td>
              <td className="num" style={{ padding: "6px 0", textAlign: "right", verticalAlign: "top" }}>
                {formatBaht(item.subtotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="t-small" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>ยอดรวม</span>
          <span className="num">฿{formatBaht(data.subtotal)}</span>
        </span>
        {data.discount > 0 ? (
          <span className="row" style={{ justifyContent: "space-between" }}>
            <span>ส่วนลด</span>
            <span className="num">−฿{formatBaht(data.discount)}</span>
          </span>
        ) : null}
        <span
          className="row"
          style={{
            justifyContent: "space-between",
            fontWeight: 700,
            fontSize: "1rem",
            borderTop: "1px solid var(--line)",
            paddingTop: 6,
          }}
        >
          <span>ยอดสุทธิ</span>
          <span className="num">฿{formatBaht(data.total)}</span>
        </span>
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>ชำระโดย</span>
          <span>{PAYMENT_METHOD_LABEL[data.paymentMethod]}</span>
        </span>
        <span className="row" style={{ justifyContent: "space-between" }}>
          <span>รับเงิน</span>
          <span className="num">฿{formatBaht(data.amountReceived)}</span>
        </span>
        {data.paymentMethod === "CASH" ? (
          <span className="row" style={{ justifyContent: "space-between" }}>
            <span>เงินทอน</span>
            <span className="num">฿{formatBaht(data.changeDue)}</span>
          </span>
        ) : null}
        {data.note ? (
          <span className="row" style={{ justifyContent: "space-between" }}>
            <span>หมายเหตุ</span>
            <span>{data.note}</span>
          </span>
        ) : null}
      </div>

      <p className="t-caption" style={{ textAlign: "center", marginTop: 14 }}>
        ขอบคุณที่ใช้บริการ
      </p>
    </div>
  )
}
