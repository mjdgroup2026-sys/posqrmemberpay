"use client"

import { useEffect } from "react"
import { formatBusinessDate, formatClock, formatDateTime } from "@/lib/format"
import type { BookingTicketDoc } from "@/lib/queries"

/// ทิกเก็ตจัดห้อง/จัดคนนวด (2026-10-08) — พิมพ์หลังเช็กอิน ให้พนักงานถือไปจัดห้องและตามคนนวด
///
/// พิมพ์ผ่านกล่องพิมพ์ของเบราว์เซอร์แบบเดียวกับทิกเก็ตครัว (`components/kitchen-ticket.tsx`) — ฟอนต์ไทยไม่เพี้ยน
/// · `?auto=1` = เปิดกล่องพิมพ์ให้ทันที (ปุ่ม "พิมพ์ทิกเก็ต" บนตารางจองเปิดแบบนี้)
/// · ไม่บันทึกว่าพิมพ์แล้ว — ทิกเก็ตนี้ไม่มีคิวพิมพ์อัตโนมัติให้กันซ้ำ พิมพ์ซ้ำได้เสมอ
export function BookingTicket({ ticket, auto }: { ticket: BookingTicketDoc; auto: boolean }) {
  useEffect(() => {
    if (!auto) return
    // รอให้ฟอนต์โหลดเสร็จก่อนเปิดกล่องพิมพ์ ไม่งั้นตัวอย่างใน PDF อาจได้ฟอนต์สำรอง
    const timer = setTimeout(() => window.print(), 400)
    return () => clearTimeout(timer)
  }, [auto])

  return (
    <div style={{ padding: 24, display: "grid", placeItems: "start center", minHeight: "100dvh" }}>
      <div className="no-print" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          พิมพ์ทิกเก็ต
        </button>
        <button type="button" className="btn btn-subtle" onClick={() => window.close()}>
          ปิดหน้านี้
        </button>
      </div>

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
          <p className="t-eyebrow" style={{ marginTop: 4 }}>
            ทิกเก็ตจัดห้อง
          </p>
          <p style={{ fontSize: "1.6rem", fontWeight: 800, lineHeight: 1.2 }}>
            {ticket.roomCode ? `ห้อง ${ticket.roomCode}` : "ยังไม่ระบุห้อง"}
          </p>
          <p className="t-caption">{formatBusinessDate(ticket.startAt)}</p>
        </div>

        <dl style={{ borderTop: "1px dashed var(--line)", paddingTop: 10, display: "grid", gap: 8 }}>
          <TicketRow label="เวลา">
            <span className="num" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {formatClock(ticket.startAt)}–{formatClock(ticket.endAt)} น.
            </span>
          </TicketRow>
          <TicketRow label="พนักงานนวด">
            <span style={{ fontSize: "1.15rem", fontWeight: 700 }}>{ticket.therapistLabel}</span>
          </TicketRow>
          <TicketRow label="โปรแกรม">
            {ticket.programName} <span className="num">({ticket.durationMinutes} นาที)</span>
          </TicketRow>
          <TicketRow label="ลูกค้า">
            {ticket.customerName}
            {ticket.customerPhone ? <span className="num"> · {ticket.customerPhone}</span> : null}
          </TicketRow>
          {ticket.note ? <TicketRow label="หมายเหตุ">* {ticket.note}</TicketRow> : null}
        </dl>

        <p
          className="t-caption"
          style={{ borderTop: "1px dashed var(--line)", marginTop: 12, paddingTop: 10, textAlign: "center" }}
        >
          {ticket.checkedInAt ? `เช็กอิน ${formatClock(ticket.checkedInAt)} น. · ` : ""}พิมพ์เมื่อ {formatDateTime(new Date())}
        </p>
      </div>
    </div>
  )
}

function TicketRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="t-caption">{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  )
}
