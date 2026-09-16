"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { submitPaymentSlip } from "@/app/actions/payments"
import { IconCamera, IconSpinner } from "@/components/icons"

/// แนบสลิปให้ระบบตรวจแล้วปิดบิลเอง (Phase 15b — โหมด ก+)
///
/// อ่าน QR บนสลิป **ฝั่งเบราว์เซอร์** ด้วย jsQR แล้วส่งเฉพาะข้อความ payload ขึ้น server — ไม่อัปโหลดรูป
/// (รูปสลิปมีชื่อ/เลขบัญชีผู้โอน ไม่ควรวิ่งผ่านเซิร์ฟเวอร์เรา และประหยัดเน็ตมือถือ) · jsQR ถูก import แบบ dynamic
/// ตอนผู้ใช้เลือกไฟล์ จึงไม่ถ่วงหน้าจ่ายเงินให้ทุกคน · ในโหมด mock (dev) มีช่องวาง payload ทดสอบให้

type Props = {
  qrToken: string
  /// SLIP_PROVIDER=mock — โชว์ช่องวาง payload ทดสอบ
  mockMode: boolean
}

type Phase = "idle" | "reading" | "verifying"

/// ลดขนาดรูปก่อนถอด QR — สลิปจากกล้องมือถือใหญ่ 3–4 พันพิกเซล jsQR ช้าและกินหน่วยความจำ · 1600px พอสำหรับ mini-QR
const MAX_EDGE = 1600

async function decodeQrFromFile(file: File): Promise<string | null> {
  const [{ default: jsQR }, bitmap] = await Promise.all([import("jsqr"), createImageBitmap(file)])
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  // สลิปพื้นขาว QR ดำ — ลองทั้งแบบปกติและกลับสี เผื่อธีมมืดของแอปธนาคาร
  const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })
  return found?.data ?? null
}

export function SlipUpload({ qrToken, mockMode }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [mockPayload, setMockPayload] = useState("")

  async function verify(payload: string) {
    setPhase("verifying")
    setError(null)
    try {
      const fd = new FormData()
      fd.set("qrToken", qrToken)
      fd.set("payload", payload)
      const result = await submitPaymentSlip(fd)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/order/${qrToken}/pay/success`)
      router.refresh()
    } catch {
      setError("ส่งสลิปไม่สำเร็จ กรุณาลองใหม่หรือแจ้งพนักงาน")
    } finally {
      setPhase("idle")
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setPhase("reading")
    setError(null)
    try {
      const payload = await decodeQrFromFile(file)
      if (!payload) {
        setError("อ่าน QR บนสลิปไม่ได้ — ลองถ่ายให้ชัดขึ้น ให้เห็น QR มุมสลิปเต็ม ๆ")
        setPhase("idle")
        return
      }
      await verify(payload)
    } catch {
      setError("เปิดรูปไม่ได้ กรุณาลองไฟล์อื่น")
      setPhase("idle")
    }
  }

  const busy = phase !== "idle"

  return (
    <section className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="t-h3" style={{ margin: 0 }}>
        โอนแล้ว? แนบสลิปเพื่อปิดบิลทันที
      </p>
      <p className="t-caption" style={{ margin: 0 }}>
        เลือกรูปสลิปจากแอปธนาคาร ระบบอ่าน QR บนสลิปในเครื่องคุณเองแล้วตรวจกับธนาคาร — ไม่ต้องรอพนักงาน
      </p>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} disabled={busy} />
      <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <IconSpinner size={18} className="animate-spin" aria-hidden /> : <IconCamera size={18} aria-hidden />}
        {phase === "reading" ? "กำลังอ่านสลิป…" : phase === "verifying" ? "กำลังตรวจกับธนาคาร…" : "แนบสลิปโอนเงิน"}
      </button>
      {error ? (
        <div className="alert-banner warning" role="alert">
          {error}
        </div>
      ) : null}

      {mockMode ? (
        <details>
          <summary className="t-caption">โหมดทดสอบ — วาง payload จำลอง</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            <input
              className="input num"
              value={mockPayload}
              onChange={(e) => setMockPayload(e.target.value)}
              placeholder="MOCK|TX123|120.00|0812345678|0"
              disabled={busy}
            />
            <button type="button" className="btn btn-subtle btn-sm" disabled={busy || !mockPayload.trim()} onClick={() => void verify(mockPayload)}>
              ส่ง payload ทดสอบ
            </button>
            <span className="t-caption">MOCK|transRef|ยอด|เลขพร้อมเพย์ร้าน|โอนเมื่อกี่นาทีก่อน · transRef ขึ้นต้น DOWN = ผู้ให้บริการล่ม, DUP = ซ้ำ</span>
          </div>
        </details>
      ) : null}
    </section>
  )
}
