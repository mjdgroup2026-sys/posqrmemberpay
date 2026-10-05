"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { startCustomerPayment } from "@/app/actions/payments"
import { formatBaht } from "@/lib/format"
import { IconCard, IconQr, IconSpinner } from "@/components/icons"
import { usePaymentPoll } from "@/components/customer/payment-poll"

export type PayBill = {
  itemsTotal: number
  /// ส่วนลดที่พนักงานให้ (2026-10-05) — ไม่ส่ง = 0
  discount?: number
  servicePercent: number
  serviceCharge: number
  total: number
}

/// เลือกวิธีชำระเงิน (F17) — PromptPay เป็นค่าเริ่มต้น, Card จ่ายที่เคาน์เตอร์ผ่านเครื่อง EDC
export function PayView({
  qrToken,
  bill,
  promptPayReady,
}: {
  qrToken: string
  bill: PayBill
  promptPayReady: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<"PROMPTPAY" | "CARD" | null>(null)
  const [waitingCard, setWaitingCard] = useState(false)

  // รอพนักงานกดยืนยันบัตรที่เคาน์เตอร์ — ปิดบิลเมื่อไหร่หน้านี้พาไปหน้าสำเร็จให้เอง
  usePaymentPoll(qrToken, waitingCard)

  async function choose(method: "PROMPTPAY" | "CARD") {
    setPending(method)
    const formData = new FormData()
    formData.set("qrToken", qrToken)
    formData.set("method", method)

    try {
      const result = await startCustomerPayment(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      if (method === "PROMPTPAY") {
        router.push(`/order/${qrToken}/pay/promptpay`)
        return
      }
      setWaitingCard(true)
    } catch {
      toast.error("เริ่มการชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(null)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="card-ui card-pad">
        <h2 className="t-h3" style={{ marginBottom: 10 }}>
          ยอดที่ต้องชำระ
        </h2>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="t-small">ค่าอาหาร</span>
          <span className="num">฿{formatBaht(bill.itemsTotal)}</span>
        </div>
        {bill.discount && bill.discount > 0 ? (
          <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
            <span className="t-small">ส่วนลด</span>
            <span className="num">−฿{formatBaht(bill.discount)}</span>
          </div>
        ) : null}
        {bill.serviceCharge > 0 ? (
          <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
            <span className="t-small">ค่าบริการ {bill.servicePercent}%</span>
            <span className="num">฿{formatBaht(bill.serviceCharge)}</span>
          </div>
        ) : null}
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            fontWeight: 700,
            fontSize: "1.15rem",
            borderTop: "1px solid var(--line)",
            marginTop: 12,
            paddingTop: 12,
          }}
        >
          <span>รวมทั้งสิ้น</span>
          <span className="num">฿{formatBaht(bill.total)}</span>
        </div>
      </section>

      {waitingCard ? (
        <>
          <div className="alert-banner info">
            แจ้งพนักงานแล้ว — กรุณานำบัตรไปชำระที่เคาน์เตอร์ เมื่อพนักงานยืนยันแล้วหน้านี้จะเปลี่ยนเองอัตโนมัติ
          </div>
          <p className="row t-small" style={{ justifyContent: "center", gap: 8 }}>
            <IconSpinner size={16} className="animate-spin" aria-hidden />
            กำลังรอการยืนยัน…
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={pending !== null || bill.total <= 0 || !promptPayReady}
            onClick={() => choose("PROMPTPAY")}
          >
            {pending === "PROMPTPAY" ? (
              <IconSpinner size={18} className="animate-spin" aria-hidden />
            ) : (
              <IconQr size={18} aria-hidden />
            )}
            ชำระด้วยพร้อมเพย์
          </button>
          {promptPayReady ? null : (
            <p className="t-caption" style={{ textAlign: "center" }}>
              ร้านยังไม่ได้เปิดใช้งานพร้อมเพย์ — กรุณาชำระที่เคาน์เตอร์
            </p>
          )}

          <button
            type="button"
            className="btn btn-subtle btn-lg btn-block"
            disabled={pending !== null || bill.total <= 0}
            onClick={() => choose("CARD")}
          >
            {pending === "CARD" ? (
              <IconSpinner size={18} className="animate-spin" aria-hidden />
            ) : (
              <IconCard size={18} aria-hidden />
            )}
            ชำระด้วยบัตรที่เคาน์เตอร์
          </button>
        </>
      )}

      <Link href={`/order/${qrToken}/status`} className="btn btn-ghost btn-block">
        กลับไปดูสถานะออร์เดอร์
      </Link>
    </div>
  )
}
