import "server-only"

/// Realtime แบบ SSE (Server-Sent Events) — event bus ในโปรเซสเดียว ต่อร้าน
///
/// ทำไมไม่ใช่ Socket.IO: ต้องมี custom server ซึ่งชนกับ `output: "standalone"` + blue/green (ดู spec §8 Phase 8) ·
/// SSE เป็น route handler ธรรมดา ทำงานผ่าน nginx ได้ทันที และทุกอย่างที่ต้อง realtime ในระบบนี้เป็นทางเดียว server → หน้าจอ
///
/// กติกา:
///   · event เป็นแค่ "สัญญาณว่าอะไรเปลี่ยน" (topic) **ไม่พกข้อมูล** — ผู้รับไป fetch/refresh เอง จึงไม่มีทางรั่วข้อมูลข้ามร้าน
///     แม้จะส่งผิดช่อง · ช่องแยกตาม storeId ผู้สมัครรับต้องพิสูจน์ว่าอยู่ร้านนั้น (route handler เป็นคนตรวจ)
///   · bus อยู่ในโปรเซสเดียว: ตอนสลับสี blue→green มีสองโปรเซสชั่วคราว event ที่เกิดในสีเก่าไม่ถึงคนที่ต่อสีใหม่ —
///     client จึงต้องคง polling ช้า ๆ เป็น fallback เสมอ (components/auto-refresh.tsx) · รันหลายอินสแตนซ์จริงเมื่อไหร่ค่อยย้าย
///     ไป Postgres LISTEN/NOTIFY หรือ Redis
///   · เก็บบน globalThis กัน Turbopack HMR สร้าง module ใหม่แล้ว listener เดิมหาย (dev เท่านั้น production ไม่มีผล)

export type RealtimeTopic = "tables" | "orders" | "notifications" | "payments" | "menu"

export type RealtimeEvent = { topic: RealtimeTopic; at: number }

type Listener = (event: RealtimeEvent) => void

type Bus = Map<string, Set<Listener>>

const KEY = "__mjd_realtime_bus__"
const bus: Bus = ((globalThis as Record<string, unknown>)[KEY] as Bus | undefined) ?? new Map()
;(globalThis as Record<string, unknown>)[KEY] = bus

/// แจ้งทุกหน้าจอของร้านว่า topic นี้เปลี่ยน — เรียกหลังเขียน DB สำเร็จ (คู่กับ revalidatePath) · ไม่ throw ไม่ await
export function publishStoreEvent(storeId: string, topic: RealtimeTopic): void {
  const listeners = bus.get(storeId)
  if (!listeners || listeners.size === 0) return
  const event: RealtimeEvent = { topic, at: Date.now() }
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error("[realtime] listener ล้ม:", error)
    }
  }
}

/// สมัครรับ event ของร้าน — คืนฟังก์ชันยกเลิก · ผู้เรียกต้องยกเลิกเมื่อ stream ปิด ไม่งั้น listener ค้างทั้งชีวิตโปรเซส
export function subscribeStore(storeId: string, listener: Listener): () => void {
  let listeners = bus.get(storeId)
  if (!listeners) {
    listeners = new Set()
    bus.set(storeId, listeners)
  }
  listeners.add(listener)
  return () => {
    const current = bus.get(storeId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) bus.delete(storeId)
  }
}

/// จำนวนผู้ฟังของร้าน — ใช้ในเทส/ตรวจสุขภาพ
export function listenerCount(storeId: string): number {
  return bus.get(storeId)?.size ?? 0
}

/// heartbeat ทุก 25 วิ — ต่ำกว่า proxy_read_timeout 60 วิ ของ nginx และกัน mobile network ปิด connection ที่เงียบ
export const SSE_HEARTBEAT_MS = 25_000

/// สร้าง Response แบบ text/event-stream ที่ผูกกับช่องของร้าน · `filter` เลือกว่า topic ไหนถึงจะส่ง
/// ปิดเมื่อ client ยกเลิก (request.signal) — ทั้ง listener และ timer ถูกเก็บกวาดใน cancel()
export function sseResponse(storeId: string, signal: AbortSignal, filter?: (topic: RealtimeTopic) => boolean): Response {
  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (line: string) => {
        try {
          controller.enqueue(encoder.encode(line))
        } catch {
          // controller ปิดไปแล้ว (client หลุด) — cancel() จะตามมาเก็บกวาด
        }
      }
      // retry บอกเบราว์เซอร์ให้ต่อใหม่เร็ว ๆ หลังหลุด (ค่าเริ่มต้นของเบราว์เซอร์ ~3 วิอยู่แล้ว ระบุไว้ให้ชัด)
      send("retry: 3000\n\n")
      send(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`)

      const unsubscribe = subscribeStore(storeId, (event) => {
        if (filter && !filter(event.topic)) return
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`)
      })
      const heartbeat = setInterval(() => send(": ping\n\n"), SSE_HEARTBEAT_MS)

      cleanup = () => {
        unsubscribe()
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // ปิดไปแล้ว
        }
      }
      signal.addEventListener("abort", () => cleanup?.(), { once: true })
    },
    cancel() {
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // บอก nginx ไม่ให้ buffer response นี้ — ไม่งั้น event ค้างอยู่ใน proxy จนกว่าจะเต็ม buffer
      "X-Accel-Buffering": "no",
    },
  })
}
