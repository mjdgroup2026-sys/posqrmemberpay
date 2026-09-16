"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRealtime } from "@/components/use-realtime"
import Link from "next/link"
import { formatBaht, formatClock, formatNumber } from "@/lib/format"
import type { CustomerOrderView, OrderItemRow } from "@/lib/queries"

/// 4 ขั้นของสถานะที่ลูกค้าเห็น (F14) — ร้านที่ไม่มี KDS จะกระโดดจากขั้น 2 ไป "เสิร์ฟแล้ว" เลย
const STEPS = ["ส่งออร์เดอร์แล้ว", "ครัวรับออร์เดอร์", "กำลังปรุง", "พร้อมเสิร์ฟ/เสิร์ฟแล้ว"]

function stepOf(status: OrderItemRow["status"]): number {
  switch (status) {
    case "AWAITING_KITCHEN":
      return 1
    case "COOKING":
      return 2
    case "READY":
      return 3
    case "SERVED":
      return 4
    default:
      return 0
  }
}

const ITEM_LABEL: Record<OrderItemRow["status"], string> = {
  AWAITING_KITCHEN: "รอครัวรับ",
  COOKING: "กำลังปรุง",
  READY: "พร้อมเสิร์ฟ",
  SERVED: "เสิร์ฟแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
}

/// สถานะออร์เดอร์: SSE จาก /api/order/[qrToken]/events บอกว่ามีอะไรเปลี่ยน → ดึงสถานะใหม่ทันที · polling เป็นทางสำรอง
/// (4 วิเมื่อต่อ SSE ไม่ได้ · 20 วิเมื่อต่อได้) — ฝั่งลูกค้าไม่ใช้ WebSocket โดยตั้งใจ (§6a Realtime)
export function StatusView({ qrToken, initial }: { qrToken: string; initial: CustomerOrderView }) {
  const [view, setView] = useState(initial)
  const cancelledRef = useRef(false)

  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    try {
      const response = await fetch(`/api/order/${qrToken}/status`, { cache: "no-store" })
      if (!response.ok) return
      const data = (await response.json()) as { ok: boolean; view?: CustomerOrderView }
      if (!cancelledRef.current && data.ok && data.view) setView(data.view)
    } catch {
      // เน็ตมือถือสะดุดเป็นเรื่องปกติ — รอบถัดไปดึงใหม่เอง
    }
  }, [qrToken])

  const connected = useRealtime(`/api/order/${qrToken}/events`, poll)

  useEffect(() => {
    cancelledRef.current = false
    const timer = setInterval(poll, connected ? 20_000 : 4000)
    return () => {
      cancelledRef.current = true
      clearInterval(timer)
    }
  }, [poll, connected])

  const items = view.orders.flatMap((o) => o.items).filter((i) => i.status !== "CANCELLED")
  const minStep = items.length === 0 ? 0 : Math.min(...items.map((i) => stepOf(i.status)))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="card-ui card-pad">
        <h2 className="t-h3" style={{ marginBottom: 12 }}>
          สถานะออร์เดอร์
        </h2>
        <ol style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {STEPS.map((label, index) => {
            const step = index + 1
            const done = minStep >= step
            return (
              <li key={label} className="row" style={{ gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    background: done ? "var(--brand)" : "var(--surface-2)",
                    color: done ? "var(--brand-ink)" : "var(--ink-3)",
                  }}
                >
                  {step}
                </span>
                <span style={{ fontWeight: done ? 600 : 400, color: done ? undefined : "var(--ink-3)" }}>
                  {label}
                </span>
              </li>
            )
          })}
        </ol>
      </section>

      {view.orders.map((order) => (
        <section key={order.id} className="card-ui card-pad">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h3 className="t-h3">ออร์เดอร์ที่ {order.orderNumber}</h3>
            <span className="t-caption num">{formatClock(order.submittedAt)}</span>
          </div>

          <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {order.items.map((item) => (
              <li
                key={item.id}
                className="row"
                style={{ justifyContent: "space-between", gap: 10, opacity: item.status === "CANCELLED" ? 0.6 : 1 }}
              >
                <span>
                  <span className="num" style={{ fontWeight: 700 }}>
                    {formatNumber(item.quantity)}×
                  </span>{" "}
                  {item.menuItemName}
                  {item.options.length > 0 ? (
                    <span className="t-caption"> ({item.options.map((o) => o.optionName).join(", ")})</span>
                  ) : null}
                </span>
                <span className="t-caption">{ITEM_LABEL[item.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="card-ui card-pad">
        <div className="row" style={{ justifyContent: "space-between", fontWeight: 700 }}>
          <span>ยอดรวมปัจจุบัน</span>
          <span className="num">฿{formatBaht(view.total)}</span>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
        <Link href={`/order/${qrToken}/menu`} className="btn btn-subtle btn-sm">
          สั่งเพิ่ม
        </Link>
        <Link href={`/order/${qrToken}/call-staff`} className="btn btn-subtle btn-sm">
          เรียกพนักงาน
        </Link>
        <Link href={`/order/${qrToken}/check-bill`} className="btn btn-primary btn-sm">
          เช็กบิล
        </Link>
      </div>
    </div>
  )
}
