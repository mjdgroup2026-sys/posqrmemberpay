import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import proxy from "@/proxy"

/// หน้าแนะนำระบบ/คู่มือ (2026-10-02) — คนที่ยังไม่ล็อกอินต้องเปิดได้ และหน้าแรกของคนนอกคือ /welcome

function call(path: string, withSession = false) {
  const headers = new Headers()
  if (withSession) headers.set("cookie", "better-auth.session_token=fake")
  return proxy(new NextRequest(new URL(path, "http://localhost:3001"), { headers }))
}

describe("proxy: หน้าสาธารณะ", () => {
  it("ยังไม่ล็อกอิน เข้า / → เด้งไป /welcome", () => {
    const res = call("/")
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/welcome")
  })

  it("ยังไม่ล็อกอิน เปิด /welcome และ /guide ได้", () => {
    expect(call("/welcome").headers.get("location")).toBeNull()
    expect(call("/guide").headers.get("location")).toBeNull()
  })

  it("ล็อกอินอยู่ เข้า / ได้แดชบอร์ดตามเดิม และยังเปิดคู่มือได้", () => {
    expect(call("/", true).headers.get("location")).toBeNull()
    expect(call("/guide", true).headers.get("location")).toBeNull()
  })

  it("หน้าอื่นที่ยังไม่ล็อกอินยังเด้งไป /login เหมือนเดิม", () => {
    const res = call("/pos/history")
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login")
  })
})
