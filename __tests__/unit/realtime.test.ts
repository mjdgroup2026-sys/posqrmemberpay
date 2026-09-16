import { describe, expect, it, vi } from "vitest"
import { listenerCount, publishStoreEvent, sseResponse, subscribeStore } from "@/lib/realtime"

/// event bus ของ SSE (Phase 8 realtime) — แยกช่องตามร้าน · ยกเลิกแล้วต้องไม่ได้รับ · stream ส่ง ready แล้วตามด้วย change

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read()
  return new TextDecoder().decode(value)
}

describe("realtime bus", () => {
  it("publish ถึงเฉพาะผู้ฟังของร้านนั้น · unsubscribe แล้วไม่ได้รับ · นับผู้ฟังถูก", () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeStore("store-a", a)
    const offB = subscribeStore("store-b", b)
    expect(listenerCount("store-a")).toBe(1)

    publishStoreEvent("store-a", "tables")
    expect(a).toHaveBeenCalledTimes(1)
    expect(a.mock.calls[0][0]).toMatchObject({ topic: "tables" })
    expect(b).not.toHaveBeenCalled()

    offA()
    publishStoreEvent("store-a", "orders")
    expect(a).toHaveBeenCalledTimes(1)
    expect(listenerCount("store-a")).toBe(0)
    offB()
  })

  it("listener ที่ throw ไม่ทำให้ตัวอื่นพลาด และไม่ทำให้ publish โยน", () => {
    const bad = vi.fn(() => {
      throw new Error("boom")
    })
    const good = vi.fn()
    const off1 = subscribeStore("store-c", bad)
    const off2 = subscribeStore("store-c", good)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => publishStoreEvent("store-c", "menu")).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    off1()
    off2()
  })

  it("sseResponse: header ถูก · ส่ง retry + ready ก่อน · change ตาม filter · abort แล้วผู้ฟังหาย", async () => {
    const controller = new AbortController()
    const response = sseResponse("store-d", controller.signal, (topic) => topic !== "menu")
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("x-accel-buffering")).toBe("no")

    const reader = response.body!.getReader()
    const first = await readChunk(reader)
    expect(first).toContain("retry: 3000")
    const ready = first.includes("event: ready") ? first : await readChunk(reader)
    expect(ready).toContain("event: ready")
    expect(listenerCount("store-d")).toBe(1)

    publishStoreEvent("store-d", "menu") // ถูก filter ทิ้ง
    publishStoreEvent("store-d", "orders")
    const change = await readChunk(reader)
    expect(change).toContain("event: change")
    expect(change).toContain('"topic":"orders"')
    expect(change).not.toContain("menu")

    controller.abort()
    await new Promise((r) => setTimeout(r, 0))
    expect(listenerCount("store-d")).toBe(0)
  })
})
