"use client"

import { useEffect, useRef, useState } from "react"

/// เชื่อม SSE (EventSource) แล้วเรียก `onChange` ทุกครั้งที่ server ส่งสัญญาณว่ามีอะไรเปลี่ยน
///
/// · debounce 300 ms — action เดียวมัก publish หลาย topic ติดกัน (tables + notifications) ไม่ต้อง refresh ซ้ำ
/// · คืน `connected` ให้ผู้เรียกปรับจังหวะ polling สำรอง: ต่อได้ = โพลช้า (60 วิ กันเคสสลับสี blue/green ที่ event หล่น) ·
///   ต่อไม่ได้ = โพลถี่เท่าเดิม · เบราว์เซอร์ reconnect ให้เองตาม `retry:` ที่ server ส่งมา
/// · หยุดฟังตอนแท็บถูกซ่อน? **ไม่** — EventSource ค้างไว้ถูกกว่าการต่อใหม่ทุกครั้งที่กลับมา และ heartbeat 25 วิเบามาก
///   แต่ onChange ตอนแท็บซ่อนถูกข้าม (ให้ refresh ตอนกลับมาเห็นแทน)
export function useRealtime(url: string | null, onChange: () => void): boolean {
  const [connected, setConnected] = useState(false)
  const latest = useRef(onChange)
  // อัปเดต ref ใน effect ไม่ใช่ตอน render (กติกา react-hooks/refs)
  useEffect(() => {
    latest.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return
    const source = new EventSource(url)
    let timer: ReturnType<typeof setTimeout> | null = null
    let missed = false

    const fire = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        missed = true
        return
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => latest.current(), 300)
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && missed) {
        missed = false
        fire()
      }
    }

    source.addEventListener("ready", () => setConnected(true))
    source.addEventListener("change", fire)
    source.onerror = () => setConnected(false)
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      if (timer) clearTimeout(timer)
      source.close()
      setConnected(false)
    }
  }, [url])

  return connected
}
