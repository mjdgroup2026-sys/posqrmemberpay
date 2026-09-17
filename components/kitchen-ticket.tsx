"use client"

import { useEffect, useRef, useState } from "react"
import { markTicketPrinted } from "@/app/actions/orders"
import { formatClock, formatDateTime, formatNumber } from "@/lib/format"
import type { KitchenTicketDoc } from "@/lib/queries"

/// ทิกเก็ตครัวสำหรับ "พิมพ์ผ่าน PDF" แทนเครื่องพิมพ์ความร้อน (Phase 8)
///
/// เบราว์เซอร์เป็นตัวสร้าง PDF เอง (Print → Save as PDF) โดยตั้งใจ — ไม่ต้องฝังฟอนต์ไทย
/// ลงไลบรารี PDF ฝั่ง server ซึ่งเป็นจุดที่ภาษาไทยพังบ่อยที่สุด (สระ/วรรณยุกต์ลอย)
/// ฟอนต์ที่ใช้คือฟอนต์ที่แอปโหลดอยู่แล้ว จึงได้ผลลัพธ์ตรงกับที่เห็นบนจอเสมอ
///
/// `?auto=1` = เปิดกล่องพิมพ์ให้ทันที (ใช้ตอนกดจากปุ่มบน KDS) · ไม่ใส่ = ดูเฉย ๆ ก่อน
export function KitchenTicket({ ticket, auto }: { ticket: KitchenTicketDoc; auto: boolean }) {
  const [printedAt, setPrintedAt] = useState(ticket.printedAt)
  const marked = useRef(false)

  async function stampPrinted() {
    // กันยิงซ้ำเมื่อผู้ใช้กดพิมพ์หลายรอบ — บันทึกครั้งแรกครั้งเดียวพอ
    if (marked.current || printedAt) return
    marked.current = true
    const formData = new FormData()
    formData.set("id", ticket.orderId)
    const result = await markTicketPrinted(formData)
    if (result.ok) setPrintedAt(new Date())
  }

  function print() {
    void stampPrinted()
    window.print()
  }

  useEffect(() => {
    if (!auto) return
    // รอให้ฟอนต์โหลดเสร็จก่อนเปิดกล่องพิมพ์ ไม่งั้นตัวอย่างใน PDF อาจได้ฟอนต์สำรอง
    const timer = setTimeout(print, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  return (
    <div style={{ padding: 24, display: "grid", placeItems: "start center", minHeight: "100dvh" }}>
      <div className="no-print" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button type="button" className="btn btn-primary" onClick={print}>
          พิมพ์ทิกเก็ต (เครื่องพิมพ์ PDF)
        </button>
        <button type="button" className="btn btn-subtle" onClick={() => window.close()}>
          ปิดหน้านี้
        </button>
      </div>

      <p className="no-print t-caption" style={{ marginBottom: 16, maxWidth: 360, textAlign: "center" }}>
        ในกล่องพิมพ์เลือกเครื่องพิมพ์เป็น &ldquo;Microsoft Print to PDF&rdquo; หรือ &ldquo;Save as PDF&rdquo;
        {printedAt ? ` · พิมพ์ล่าสุด ${formatDateTime(printedAt)}` : " · ยังไม่เคยพิมพ์ทิกเก็ตนี้"}
      </p>

      <div
        className="receipt-print"
        style={{
          width: 320,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 20,
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <p className="t-caption">{ticket.storeName}</p>
          <p style={{ fontSize: "1.6rem", fontWeight: 800, lineHeight: 1.2 }}>
            {ticket.orderType === "TAKEAWAY" ? ticket.tableCode : `โต๊ะ ${ticket.tableCode}`}
          </p>
          {ticket.mergedTableCodes.length > 0 ? (
            <p className="t-caption">รวมโต๊ะ {ticket.mergedTableCodes.join(", ")}</p>
          ) : null}
          <p style={{ fontWeight: 600 }}>ออร์เดอร์ที่ {ticket.orderNumber}</p>
          <p className="t-caption num">{formatClock(ticket.submittedAt)}</p>
        </div>

        <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
          {ticket.items.length === 0 ? (
            <p className="t-body">ไม่มีรายการที่ต้องทำ (ถูกยกเลิกทั้งหมด)</p>
          ) : (
            <ul style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ticket.items.map((item) => (
                <li key={item.id}>
                  <p style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                    <span className="num">{formatNumber(item.quantity)}</span> × {item.name}
                  </p>
                  {item.options.length > 0 ? (
                    <p className="t-caption">({item.options.join(", ")})</p>
                  ) : null}
                  {item.note ? <p className="t-caption">* {item.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p
          className="t-caption"
          style={{ borderTop: "1px dashed var(--line)", marginTop: 12, paddingTop: 10, textAlign: "center" }}
        >
          พิมพ์เมื่อ {formatDateTime(new Date())}
        </p>
      </div>
    </div>
  )
}
