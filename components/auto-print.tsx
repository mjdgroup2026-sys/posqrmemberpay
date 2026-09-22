"use client"

import { useEffect, useRef, useState } from "react"

/// พิมพ์ทิกเก็ตครัวอัตโนมัติผ่านเบราว์เซอร์ (Phase 19 — เปิดด้วย StoreSettings.kitchenAutoPrint)
///
/// วิธี: โหลดหน้า `/tickets/[orderId]?auto=1&embed=1` ใน iframe ที่ซ่อนไว้ทีละใบ (คิว) — หน้านั้นเรียก `window.print()`
/// เองและประทับ `printedAt` ผ่าน markTicketPrinted เหมือนตอนพนักงานกดปุ่ม "ทิกเก็ต" ทุกประการ
/// · ใช้ iframe ไม่ใช่ `window.open()` เพราะ popup ที่ไม่ได้เกิดจากการคลิกถูกเบราว์เซอร์บล็อก ส่วน `print()` ไม่ต้องมี gesture
/// · ⚠️ กล่องพิมพ์ของเบราว์เซอร์ยังเด้งขึ้นมาให้กด "พิมพ์" 1 ครั้งต่อใบ — จะออกเงียบ ๆ ได้ต่อเมื่อรัน Chrome ด้วย
///   `--kiosk-printing` (ตั้งเครื่องพิมพ์เริ่มต้นไว้) · ถ้ามีเครื่องพิมพ์ความร้อน ตั้ง `KITCHEN_PRINTER_HOST` จะเงียบสนิทและ
///   ไม่ผ่านตัวนี้เลย (server พิมพ์เองตอน commit แล้ว `printedAt` ไม่ null → ไม่เข้าคิวนี้)
/// · พิมพ์เฉพาะ orderId ที่ผู้เรียกส่งมา (KDS ส่งเฉพาะออร์เดอร์ที่โผล่ใหม่หลังเปิดหน้าและ printedAt ยัง null)
///   ของค้างเก่าตอนเปิดหน้าไม่พิมพ์รัว ๆ · แต่ละ id พิมพ์ครั้งเดียวต่อการเปิดหน้า

const PRINT_TIMEOUT_MS = 30_000

/// ข้อความที่หน้าทิกเก็ต (โหมด embed) postMessage กลับมาเมื่อกล่องพิมพ์ปิดแล้ว
export const TICKET_PRINTED_MESSAGE = "kds-ticket-printed"

export function AutoPrint({ orderIds }: { orderIds: readonly string[] }) {
  const done = useRef<Set<string>>(new Set())
  // คิวพิมพ์ — ใบแรกของคิวคือใบที่กำลังพิมพ์ · จบใบ = ตัดหัวคิวออก
  const [queue, setQueue] = useState<string[]>([])
  const current = queue[0] ?? null

  // รับงานใหม่เข้าคิว — ข้าม id ที่เคยพิมพ์แล้วในรอบการเปิดหน้านี้
  useEffect(() => {
    const fresh = orderIds.filter((id) => !done.current.has(id))
    if (fresh.length === 0) return
    for (const id of fresh) done.current.add(id)
    setQueue((prev) => [...prev, ...fresh])
  }, [orderIds])

  // ปล่อยใบถัดไปเมื่อกล่องพิมพ์ปิด (หน้าใน iframe ส่ง postMessage หลัง afterprint) หรือหมดเวลารอ
  useEffect(() => {
    if (current === null) return
    const finish = () => setQueue((prev) => (prev[0] === current ? prev.slice(1) : prev))
    const timer = setTimeout(finish, PRINT_TIMEOUT_MS)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: unknown; orderId?: unknown } | null
      if (data && typeof data === "object" && data.type === TICKET_PRINTED_MESSAGE && data.orderId === current) finish()
    }
    window.addEventListener("message", onMessage)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("message", onMessage)
    }
  }, [current])

  if (current === null) return null
  return (
    <iframe
      key={current}
      title="พิมพ์ทิกเก็ตครัวอัตโนมัติ"
      src={`/tickets/${current}?auto=1&embed=1`}
      aria-hidden
      tabIndex={-1}
      style={{ position: "fixed", width: 0, height: 0, border: 0, opacity: 0, pointerEvents: "none" }}
    />
  )
}
