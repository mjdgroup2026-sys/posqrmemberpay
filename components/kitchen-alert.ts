"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"

/// เตือนเมื่อมี "ออร์เดอร์ใหม่" โผล่บน KDS (Phase 19) — เทียบชุด orderId ระหว่างรอบ render
///
/// · รอบแรกหลัง mount ไม่เตือน (ของค้างเก่าไม่ใช่ของใหม่) · เตือนเฉพาะ id ที่ไม่เคยเห็นตั้งแต่เปิดหน้า
/// · เสียงสร้างด้วย Web Audio (oscillator 2 จังหวะ) ไม่ต้องมีไฟล์เสียง
/// · เบราว์เซอร์ห้ามเล่นเสียงจนกว่าผู้ใช้จะโต้ตอบกับหน้าครั้งแรก → ต้องมีปุ่ม "เปิดเสียง" ให้กดปลดล็อก AudioContext
///   แล้วจำไว้ใน localStorage ต่อเครื่อง (KDS มักเปิดค้างทั้งวัน กดครั้งเดียวพอ) · ค่าที่จำเป็นแค่ "ความตั้งใจ"
///   ถ้าเบราว์เซอร์ยังไม่ปลดล็อก (เปิดแท็บใหม่โดยไม่แตะหน้า) เสียงรอบแรกอาจเงียบ — toast ยังขึ้นเสมอ

const STORAGE_KEY = "kds-sound"

// ── ค่าที่จำต่อเครื่อง อ่านผ่าน useSyncExternalStore (แบบเดียวกับ lib/use-cart.ts) เลี่ยง setState ใน effect ──
const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}
function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on"
  } catch {
    return false
  }
}
function writeSoundPref(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off")
  } catch {
    // private mode / บล็อก storage — ใช้ได้แค่ในแท็บนี้ผ่าน listeners
  }
  for (const l of listeners) l()
}

type AudioContextCtor = typeof AudioContext
function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null
  const w = window as Window & { webkitAudioContext?: AudioContextCtor }
  return window.AudioContext ?? w.webkitAudioContext ?? null
}

export function useKitchenAlert(
  /// orderId ของทิกเก็ตที่มีรายการ "รอครัวรับ" อยู่ตอนนี้ (สิ่งที่ถือว่า "ใหม่" สำหรับครัว)
  incomingOrderIds: readonly string[],
  /// ป้ายให้ toast เช่น "โต๊ะ A1" ต่อ orderId
  labelOf: (orderId: string) => string,
  options: { soundEnabledByStore: boolean },
): { soundOn: boolean; toggleSound: () => void; newOrderIds: string[] } {
  const seen = useRef<Set<string> | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const soundOn = useSyncExternalStore(subscribe, readSoundPref, () => false)
  const [newOrderIds, setNewOrderIds] = useState<string[]>([])

  const beep = useCallback(() => {
    const Ctor = getAudioContextCtor()
    if (!Ctor) return
    try {
      if (!ctx.current) ctx.current = new Ctor()
      const ac = ctx.current
      if (ac.state === "suspended") void ac.resume()
      const now = ac.currentTime
      for (const [i, freq] of [880, 1175].entries()) {
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.type = "sine"
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, now + i * 0.22)
        gain.gain.exponentialRampToValueAtTime(0.4, now + i * 0.22 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.2)
        osc.connect(gain).connect(ac.destination)
        osc.start(now + i * 0.22)
        osc.stop(now + i * 0.22 + 0.22)
      }
    } catch {
      // เสียงเป็นของเสริม — เล่นไม่ได้ก็แค่เงียบ toast ยังขึ้น
    }
  }, [])

  const toggleSound = useCallback(() => {
    const next = !readSoundPref()
    writeSoundPref(next)
    // การกดปุ่มคือ user gesture → ถือโอกาสปลดล็อก AudioContext + ให้ได้ยินตัวอย่างเสียงทันที
    if (next) beep()
  }, [beep])

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(incomingOrderIds)
      return
    }
    const fresh = incomingOrderIds.filter((id) => !seen.current?.has(id))
    if (fresh.length === 0) return
    for (const id of fresh) seen.current.add(id)
    // เรียกใน effect โดยตั้งใจ: เป็นการ "ตอบสนองต่อข้อมูลใหม่จาก server" (external system) ไม่ใช่ derive จาก props
     
    setNewOrderIds(fresh)

    const labels = fresh.map(labelOf)
    toast.info(fresh.length === 1 ? `ออร์เดอร์ใหม่ — ${labels[0]}` : `ออร์เดอร์ใหม่ ${fresh.length} ใบ — ${labels.join(", ")}`, {
      duration: 8000,
    })
    if (soundOn && options.soundEnabledByStore) beep()
  }, [incomingOrderIds, labelOf, soundOn, options.soundEnabledByStore, beep])

  return { soundOn, toggleSound, newOrderIds }
}
