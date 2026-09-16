"use client"

import { useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useRealtime } from "@/components/use-realtime"

/// ทำให้หน้าจอพนักงาน (ผังโต๊ะ / KDS / แจ้งเตือน / รายละเอียดโต๊ะ) เห็นความเปลี่ยนแปลงเกือบทันที
///
/// ทางหลัก: SSE จาก /api/events — server ส่งสัญญาณเมื่อมี action/callback แตะข้อมูลของร้าน แล้วเรา router.refresh()
/// ทางสำรอง: polling ตามรอบเดิม (`seconds`) เมื่อยังต่อ SSE ไม่ได้ · ต่อได้แล้วชะลอเป็น 60 วิ — ไม่ปิดเพราะ event bus อยู่
/// ในโปรเซสเดียว ตอนสลับสี blue/green อาจมี event หล่นช่วงสั้น ๆ (ดู lib/realtime.ts)
/// · ตอนแท็บถูกซ่อนหยุดโพล (กันยิงถี่ทิ้งเปล่าเวลาเครื่องครัวพักหน้าจอ)
const CONNECTED_FALLBACK_SECONDS = 60

export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter()
  const refresh = useCallback(() => router.refresh(), [router])
  const connected = useRealtime("/api/events", refresh)

  useEffect(() => {
    const interval = (connected ? CONNECTED_FALLBACK_SECONDS : seconds) * 1000
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      router.refresh()
    }, interval)
    return () => clearInterval(timer)
  }, [router, seconds, connected])

  return null
}
