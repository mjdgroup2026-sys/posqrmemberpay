"use client"

import { useState } from "react"
import { IconCheck, IconCopy } from "@/components/icons"

/// ปุ่มคัดลอกข้อความ (2026-10-05 · หน้าติดต่อทีมงาน) — คอมที่โทรไม่ได้ก็คัดลอกเบอร์/อีเมลไปใช้ต่อได้
export function CopyTextButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // เบราว์เซอร์ไม่ให้สิทธิ์คลิปบอร์ด — ข้อความยังเลือกคัดลอกเองได้จากหน้าจอ
    }
  }

  return (
    <button type="button" className="btn btn-subtle" onClick={() => void copy()} aria-label={`คัดลอก${label}`}>
      {copied ? <IconCheck size={16} aria-hidden /> : <IconCopy size={16} aria-hidden />}
      {copied ? "คัดลอกแล้ว" : "คัดลอก"}
    </button>
  )
}
