"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { CustomerPaymentStatus } from "@/lib/queries"
import { useRealtime } from "@/components/use-realtime"

/// โพลสถานะการชำระเงินแล้วพาไปหน้า "จ่ายสำเร็จ" ทันทีที่บิลถูกปิด
///
/// ใช้ทั้งฝั่ง PromptPay (webhook ปิดบิลให้เอง) และฝั่ง Card (พนักงานกดยืนยันที่เคาน์เตอร์) —
/// ลูกค้าไม่ต้องกดอะไรเพิ่มทั้งสองทาง ตาม F17 · หยุดโพลเมื่อแท็บถูกซ่อนเพื่อไม่กินเน็ตมือถือ
///
/// ⚠️ **ห้ามหยุดโพลเพราะ QR บนจอหมดอายุ** — นาฬิกาถอยหลังบนจอเป็นของฝั่งเราเท่านั้น
/// QR ที่อยู่ในแอปธนาคารของลูกค้ายังจ่ายได้จริงหลังจากนั้น (เจอจริง 2026-09-10: ลูกค้าจ่ายสำเร็จ
/// หลังนาฬิกาหมด บิลปิดเรียบร้อยฝั่งร้าน แต่จอลูกค้าเลิกโพลไปแล้วเลยค้างที่ "QR หมดอายุ"
/// ไม่ขึ้นใบเสร็จให้เลย) · ให้ชะลอจังหวะโพลแทนการหยุด
///
/// Phase 8 realtime: SSE จาก /api/order/[qrToken]/events ทำให้ "จ่ายสำเร็จ" ขึ้นทันทีที่บิลปิด — polling ยังอยู่เป็นทางสำรอง
/// (ชะลอเป็น 20 วิเมื่อ SSE ต่อได้) เพราะ event bus อยู่ในโปรเซสเดียวและเน็ตมือถือหลุดได้
const CONNECTED_FALLBACK_MS = 20_000

export function usePaymentPoll(qrToken: string, enabled: boolean, intervalMs = 4000) {
  const router = useRouter()
  const [paid, setPaid] = useState(false)
  const cancelledRef = useRef(false)

  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    try {
      const response = await fetch(`/api/order/${qrToken}/payment`, { cache: "no-store" })
      if (!response.ok) return
      const data = (await response.json()) as { ok: boolean; status?: CustomerPaymentStatus }
      if (cancelledRef.current || !data.ok || data.status?.state !== "PAID") return
      setPaid(true)
      router.replace(`/order/${qrToken}/pay/success`)
    } catch {
      // เน็ตมือถือสะดุดเป็นเรื่องปกติ — รอบถัดไปดึงใหม่เอง
    }
  }, [qrToken, router])

  const connected = useRealtime(enabled && !paid ? `/api/order/${qrToken}/events` : null, poll)

  useEffect(() => {
    if (!enabled || paid) return
    cancelledRef.current = false
    const timer = setInterval(poll, connected ? Math.max(intervalMs, CONNECTED_FALLBACK_MS) : intervalMs)
    return () => {
      cancelledRef.current = true
      clearInterval(timer)
    }
  }, [enabled, paid, intervalMs, poll, connected])

  return paid
}
