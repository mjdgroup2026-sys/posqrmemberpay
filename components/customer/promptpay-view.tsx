"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { formatBaht } from "@/lib/format"
import { IconSpinner } from "@/components/icons"
import { usePaymentPoll } from "@/components/customer/payment-poll"

/// QR พร้อมเพย์หมดอายุใน 15 นาที — นานพอสำหรับการเปิดแอปธนาคาร แต่ไม่นานจนยอดในจอเก่ากว่าบิลจริง
/// (ลูกค้าสั่งเพิ่มระหว่างรอ = ยอดเปลี่ยน ต้องสร้าง QR ใหม่)
const EXPIRE_SECONDS = 15 * 60

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function PromptPayView({
  qrToken,
  total,
  imageDataUrl,
  autoSettle = true,
}: {
  qrToken: string
  total: number
  imageDataUrl: string
  /// true = ธนาคาร callback ปิดบิลให้ (SCB) · false = พร้อมเพย์ของร้าน พนักงานยืนยัน (หรือลูกค้าแนบสลิปใน Phase 15b)
  autoSettle?: boolean
}) {
  const [remaining, setRemaining] = useState(EXPIRE_SECONDS)
  const expiredClock = remaining === 0

  // ★ ยังโพลต่อหลังนาฬิกาหมด (แค่ช้าลง) — QR ที่ค้างอยู่ในแอปธนาคารของลูกค้ายังจ่ายได้จริง
  //   ถ้าหยุดโพล ลูกค้าที่จ่ายสำเร็จหลังนาฬิกาหมดจะไม่มีวันได้เห็นใบเสร็จ ทั้งที่บิลปิดไปแล้ว
  const paid = usePaymentPoll(qrToken, true, expiredClock ? 8000 : 4000)

  useEffect(() => {
    const timer = setInterval(() => setRemaining((value) => (value > 0 ? value - 1 : 0)), 1000)
    return () => clearInterval(timer)
  }, [])

  const expired = expiredClock && !paid

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="card-ui card-pad" style={{ textAlign: "center" }}>
        <p className="t-small">ยอดที่ต้องชำระ</p>
        <p className="t-h1 num" style={{ marginTop: 2 }}>
          ฿{formatBaht(total)}
        </p>

        <div style={{ position: "relative", marginTop: 14 }}>
          {/* ภาพ QR ถูกสร้างเป็น data URL ฝั่ง server แล้ว — หน้าเว็บไม่ต้องโหลดไลบรารี QR ลงมือถือ */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageDataUrl}
            alt="QR Code พร้อมเพย์สำหรับชำระเงิน"
            style={{ width: "100%", maxWidth: 280, margin: "0 auto", display: "block", opacity: expired ? 0.25 : 1 }}
          />
          {expired ? (
            <p
              className="t-body"
              style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontWeight: 600 }}
            >
              QR หมดอายุแล้ว
            </p>
          ) : null}
        </div>

        <p className="t-caption" style={{ marginTop: 10 }}>
          เปิดแอปธนาคาร → สแกน QR → ชำระเงิน ·{" "}
          {autoSettle ? "ระบบจะปิดบิลให้อัตโนมัติเมื่อได้รับการยืนยันจากธนาคาร" : "โอนแล้วแจ้งพนักงาน หรือแนบสลิปด้านล่างเพื่อปิดบิลทันที"}
        </p>
      </section>

      {expired ? (
        <>
          {/* ต้องบอกให้ชัดว่า "จ่ายไปแล้วไม่ต้องจ่ายซ้ำ" — ถ้าเขียนแค่ว่าหมดอายุ ลูกค้าที่เพิ่งสแกน
              จ่ายไปจะเข้าใจว่าเงินไม่เข้า แล้วกดสร้าง QR ใหม่จ่ายซ้ำอีกรอบ */}
          <div className="alert-banner info">
            QR บนหน้าจอหมดอายุแล้ว · <strong>ถ้าคุณสแกนจ่ายไปแล้ว ไม่ต้องจ่ายซ้ำ</strong> ระบบยังรอ
            การยืนยันจากธนาคารอยู่ และจะแสดงใบเสร็จให้ทันทีที่ยืนยันแล้ว
          </div>
          <p className="row t-small" style={{ justifyContent: "center", gap: 8 }}>
            <IconSpinner size={16} className="animate-spin" aria-hidden />
            กำลังตรวจสอบการชำระเงินอยู่
          </p>
          <Link href={`/order/${qrToken}/pay`} className="btn btn-primary btn-lg btn-block">
            ยังไม่ได้จ่าย · สร้าง QR ใหม่
          </Link>
        </>
      ) : (
        <p className="row t-small" style={{ justifyContent: "center", gap: 8 }}>
          <IconSpinner size={16} className="animate-spin" aria-hidden />
          {autoSettle ? "รอการยืนยันจากธนาคาร" : "รอการยืนยันการชำระเงิน"} · QR หมดอายุใน <span className="num">{mmss(remaining)}</span>
        </p>
      )}

      <Link href={`/order/${qrToken}/pay`} className="btn btn-ghost btn-block">
        เปลี่ยนวิธีชำระเงิน
      </Link>
    </div>
  )
}
