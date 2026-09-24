"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { BillSwitcher } from "@/components/bill-switcher"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { confirmMobilePayment, getStaffBillStatus, prepareStaffPromptPay, type StaffPromptPayQr } from "@/app/actions/payments"
import { useRealtime } from "@/components/use-realtime"
import { formatBaht, formatClock, formatNumber } from "@/lib/format"
import { PAYMENT_METHOD_LABEL, type FieldErrors, type PaymentMethodValue } from "@/lib/types"
import type { BillingView } from "@/lib/queries"
import { IconBack, IconReceipt, IconSpinner } from "@/components/icons"

/// วิธีชำระเงินที่หน้าปิดบิลของ MJD Mobile Order รับได้ — PROMPTPAY/CARD คือหลัก
/// ส่วน CASH/TRANSFER เผื่อลูกค้าเปลี่ยนใจมาจ่ายที่เคาน์เตอร์ (บิลยังเป็น channel = MOBILE_ORDER เหมือนกัน)
const METHODS: PaymentMethodValue[] = ["PROMPTPAY", "CARD", "CASH", "TRANSFER"]

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function BillingForm({ bill }: { bill: BillingView }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [method, setMethod] = useState<PaymentMethodValue>("PROMPTPAY")
  const [cashInput, setCashInput] = useState("")
  const [reference, setReference] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  // พร้อมเพย์ต้องแสดง QR ให้ลูกค้าสแกนก่อนเสมอ (20f) — เดิมกดยืนยันแล้วปิดบิลเลยโดยไม่มี QR
  const [qr, setQr] = useState<StaffPromptPayQr | null>(null)
  const [qrPending, setQrPending] = useState(false)
  // ยอดเปลี่ยนหลังออก QR (ลูกค้าสั่งเพิ่ม) = QR เดิมยอดไม่ตรงแล้ว ต้องสร้างใหม่
  const qrStale = qr !== null && Math.abs(qr.amount - bill.total) >= 0.01
  const waitingBank = method === "PROMPTPAY" && qr?.mode === "AUTO" && !qrStale

  async function showQr() {
    setQrPending(true)
    try {
      const fd = new FormData()
      fd.set("sessionId", bill.sessionId)
      const result = await prepareStaffPromptPay(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setQr(result.data ?? null)
    } catch {
      toast.error("สร้าง QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setQrPending(false)
    }
  }

  /// โหมดธนาคาร: บิลปิดเองเมื่อ callback มาถึง — ฟัง SSE แล้วถามสถานะ (อ่านอย่างเดียว) · โพลสำรองทุก 3 วิ
  const checkClosed = useCallback(async () => {
    const fd = new FormData()
    fd.set("sessionId", bill.sessionId)
    const result = await getStaffBillStatus(fd).catch(() => null)
    if (result?.ok && result.data?.closed) {
      toast.success(result.data.saleNumber ? `ธนาคารยืนยันแล้ว — ปิดบิล ${result.data.saleNumber}` : "บิลนี้ถูกปิดแล้ว")
      router.push("/mobile-order/tables")
      router.refresh()
    }
  }, [bill.sessionId, router])
  useRealtime(waitingBank ? "/api/events" : null, () => void checkClosed())
  useEffect(() => {
    if (!waitingBank) return
    const timer = window.setInterval(() => void checkClosed(), 3000)
    return () => window.clearInterval(timer)
  }, [waitingBank, checkClosed])

  const received = method === "CASH" ? Number(cashInput || 0) : bill.total
  const changeDue = method === "CASH" ? round2(received - bill.total) : 0
  const cashShort = method === "CASH" && received < bill.total

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const formData = new FormData()
    formData.set("sessionId", bill.sessionId)
    formData.set("paymentMethod", method)
    formData.set("amountReceived", String(method === "CASH" ? received : bill.total))
    if (reference.trim()) formData.set("reference", reference.trim())

    try {
      const result = await confirmMobilePayment(formData)
      if (!result.ok) {
        toast.error(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      router.push("/mobile-order/tables")
      router.refresh()
    } catch {
      toast.error("ปิดบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href={`/mobile-order/tables/${bill.tableId}?session=${bill.sessionId}`} className="row" style={{ gap: 6 }}>
              <IconBack size={14} aria-hidden /> กลับไปรายละเอียดออร์เดอร์
            </Link>
          </p>
          <h1 className="t-h1">
            ปิดบิลโต๊ะ {bill.tableCode}
            {bill.customerLabel ? <> · {bill.customerLabel}</> : null}
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            เปิดโต๊ะ <span className="num">{formatClock(bill.openedAt)}</span>
            {bill.mergedTableCodes.length > 0
              ? ` · รวมโต๊ะ ${bill.mergedTableCodes.map((c) => `โต๊ะ ${c}`).join(", ")}`
              : ""}
          </p>
        </div>
        <button type="button" className="btn btn-subtle" onClick={() => window.print()}>
          <IconReceipt size={17} aria-hidden />
          พิมพ์ใบเสร็จ
        </button>
      </div>

      <BillSwitcher
        bills={bill.bills}
        currentSessionId={bill.sessionId}
        hrefFor={(sessionId) => `/mobile-order/tables/${bill.tableId}/billing?session=${sessionId}`}
      />

      {bill.sessionStatus === "AWAITING_BILL" ? (
        <div className="alert-banner info">ลูกค้าขอเช็กบิลแล้ว — ยืนยันการรับชำระเงินเพื่อปิดโต๊ะ</div>
      ) : null}

      <div className="bill-split">
        <section className="card-ui card-pad receipt-print">
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <p style={{ fontWeight: 700, fontSize: "1.05rem" }}>{bill.storeName}</p>
            <p className="t-caption">
              ใบแจ้งยอด · โต๊ะ {bill.tableCode}
              {bill.customerLabel ? ` · ${bill.customerLabel}` : ""}
            </p>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px dashed var(--line)", textAlign: "left" }}>
                <th style={{ padding: "6px 0", fontWeight: 500 }}>รายการ</th>
                <th style={{ padding: "6px 0", fontWeight: 500, textAlign: "right" }}>จำนวน</th>
                <th style={{ padding: "6px 0", fontWeight: 500, textAlign: "right" }}>รวม</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => (
                <tr key={line.id} style={{ borderBottom: "1px dashed var(--line)" }}>
                  <td style={{ padding: "8px 0" }}>
                    {line.name}
                    {line.options.length > 0 ? (
                      <span className="t-caption"> ({line.options.join(", ")})</span>
                    ) : null}
                    <br />
                    <span className="t-caption num">฿{formatBaht(line.unitPrice)} / รายการ</span>
                  </td>
                  <td className="num" style={{ padding: "8px 0", textAlign: "right" }}>
                    {formatNumber(line.quantity)}
                  </td>
                  <td className="num" style={{ padding: "8px 0", textAlign: "right" }}>
                    ฿{formatBaht(line.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="row" style={{ justifyContent: "space-between" }}>
              <span className="t-small">ค่าอาหาร</span>
              <span className="num">฿{formatBaht(bill.itemsTotal)}</span>
            </span>
            {bill.serviceCharge > 0 ? (
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="t-small">ค่าบริการ {bill.servicePercent}%</span>
                <span className="num">฿{formatBaht(bill.serviceCharge)}</span>
              </span>
            ) : null}
            <span
              className="row"
              style={{
                justifyContent: "space-between",
                fontWeight: 700,
                fontSize: "1.1rem",
                borderTop: "1px solid var(--line)",
                paddingTop: 8,
              }}
            >
              <span>รวมทั้งสิ้น</span>
              <span className="num">฿{formatBaht(bill.total)}</span>
            </span>
          </div>
        </section>

        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 14 }}>
            รับชำระเงิน
          </h2>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field">
              <label className="t-small">วิธีชำระเงิน</label>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {METHODS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={value === method ? "btn btn-primary btn-sm" : "btn btn-subtle btn-sm"}
                    onClick={() => setMethod(value)}
                  >
                    {PAYMENT_METHOD_LABEL[value]}
                  </button>
                ))}
              </div>
            </div>

            {method === "PROMPTPAY" ? (
              <div className="field" style={{ alignItems: "center", textAlign: "center", gap: 10 }}>
                {qr && !qrStale ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL ที่สร้างสด ไม่ผ่าน next/image */}
                    <img
                      src={qr.dataUrl}
                      alt={`QR พร้อมเพย์ ยอด ${formatBaht(qr.amount)} บาท`}
                      width={260}
                      height={260}
                      style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)" }}
                    />
                    <strong className="t-h2 num">฿{formatBaht(qr.amount)}</strong>
                    {qr.mode === "AUTO" ? (
                      <span className="alert-banner info" style={{ width: "100%" }}>
                        <IconSpinner size={14} className="animate-spin" aria-hidden /> ให้ลูกค้าสแกนจ่าย — ธนาคารยืนยันแล้วบิลจะปิดเองทันที
                        {qr.ref1 ? <span className="t-caption num"> · ref1 {qr.ref1}</span> : null}
                      </span>
                    ) : (
                      <span className="t-caption">
                        พร้อมเพย์ของร้าน <span className="num">{qr.maskedId}</span> — ตรวจว่าเงินเข้าแล้วจึงกดปิดบิล
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {qrStale ? <span className="alert-banner warning">ยอดบิลเปลี่ยนหลังสร้าง QR — กรุณาสร้าง QR ใหม่</span> : null}
                    <button type="button" className="btn btn-accent btn-lg btn-block" onClick={showQr} disabled={qrPending || bill.lines.length === 0}>
                      {qrPending ? <IconSpinner size={18} className="animate-spin" aria-hidden /> : null}
                      แสดง QR ให้ลูกค้าสแกน
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {method === "CASH" ? (
              <div className="field">
                <label className="t-small" htmlFor="cash">
                  รับเงินมา (บาท)
                </label>
                <input
                  id="cash"
                  className="input num"
                  inputMode="decimal"
                  autoFocus
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  placeholder={bill.total.toFixed(2)}
                />
                <span className="field-hint">
                  เงินทอน ฿<span className="num">{formatBaht(changeDue > 0 ? changeDue : 0)}</span>
                </span>
                {fieldErrors.amountReceived ? (
                  <span className="field-hint error">{fieldErrors.amountReceived}</span>
                ) : null}
              </div>
            ) : null}

            <div className="field">
              <label className="t-small" htmlFor="reference">
                เลขอ้างอิง (ไม่บังคับ)
              </label>
              <input
                id="reference"
                className="input"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === "CARD" ? "เลข slip จากเครื่อง EDC" : "เลขอ้างอิงจากธนาคาร"}
              />
              <span className="field-hint">
                ใส่ไว้กันปิดบิลซ้ำ — ถ้าเลขนี้เคยปิดบิลไปแล้ว ระบบจะคืนบิลเดิมแทนการออกบิลใหม่
              </span>
              {fieldErrors.reference ? <span className="field-hint error">{fieldErrors.reference}</span> : null}
            </div>

            <div className="row" style={{ justifyContent: "space-between", fontWeight: 700, fontSize: "1.15rem" }}>
              <span>ยอดสุทธิ</span>
              <span className="num">฿{formatBaht(bill.total)}</span>
            </div>

            <button
              type="submit"
              className={waitingBank ? "btn btn-subtle btn-block" : "btn btn-primary btn-lg btn-block"}
              // พร้อมเพย์: ต้องแสดง QR (ยอดปัจจุบัน) ก่อนถึงกดปิดบิลได้
              disabled={pending || cashShort || bill.lines.length === 0 || (method === "PROMPTPAY" && (!qr || qrStale))}
            >
              {pending ? <IconSpinner size={18} className="animate-spin" aria-hidden /> : null}
              {method === "CARD"
                ? "ยืนยันว่าบัตรตัดสำเร็จแล้ว"
                : method === "PROMPTPAY"
                  ? waitingBank
                    ? "ธนาคารไม่ยืนยัน? ตรวจแอปธนาคารแล้วปิดบิลเอง"
                    : "ได้รับเงินแล้ว — ปิดบิล"
                  : "ยืนยันรับชำระเงินและปิดโต๊ะ"}
            </button>

            <p className="t-caption">
              ปิดบิลแล้วโต๊ะทั้งกลุ่มจะกลับเป็นว่าง และ QR ชั่วคราวของโต๊ะนี้จะใช้ไม่ได้อีก
            </p>
          </form>
        </section>
      </div>
    </>
  )
}
