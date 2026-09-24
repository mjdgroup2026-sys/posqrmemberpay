"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { closeCashierDay } from "@/app/actions/closing"
import { formatBaht, formatBusinessDate } from "@/lib/format"
import type { ClosingSummary } from "@/lib/queries"
import { CLOSING_CHANNELS, CLOSING_CHANNEL_LABEL, COUNTED_FIELD, type ClosingChannel } from "@/lib/closing-channels"
import type { FieldErrors } from "@/lib/types"
import { IconSpinner } from "@/components/icons"

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const HINT: Record<ClosingChannel, string> = {
  CASH: "นับเงินในลิ้นชัก",
  TRANSFER: "ดูยอดเข้าบัญชีในแอปธนาคาร",
  QR: "ดูยอดเข้าบัญชีในแอปธนาคาร",
  PROMPTPAY: "ดูยอดเข้าบัญชีในแอปธนาคาร",
  CARD: "ดูจากสลิปสรุปยอดเครื่อง EDC",
}

/// `closingDate` = คีย์ YYYY-MM-DD ของวันทางธุรกิจที่กำลังปิด (Phase 19 — เลือกจากหน้า `/pos/closing?date=`)
/// `isToday` ใช้แค่เปลี่ยนถ้อยคำบนปุ่ม/คำเตือน ด่านจริง (ห้ามอนาคต · ปิดซ้ำไม่ได้) อยู่ที่ action
///
/// 20g: ตาราง 5 ช่องทาง ยอดในระบบ · ยอดจริงที่ตรวจได้ · ส่วนต่างสด — เงินสดบังคับกรอก ช่องทางอื่นไม่บังคับ
/// (เว้นว่าง = ไม่ได้ตรวจ ไม่ใช่ 0 · ส่วนต่างขึ้นเฉพาะช่องที่กรอก)
export function ClosingForm({
  summary,
  closingDate,
  isToday,
}: {
  summary: ClosingSummary
  closingDate: string
  isToday: boolean
}) {
  const router = useRouter()
  const [counted, setCounted] = useState<Record<ClosingChannel, string>>({ CASH: "", TRANSFER: "", QR: "", PROMPTPAY: "", CARD: "" })
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const systemTotal: Record<ClosingChannel, number> = {
    CASH: summary.totalCash,
    TRANSFER: summary.totalTransfer,
    QR: summary.totalQR,
    PROMPTPAY: summary.totalPromptPay,
    CARD: summary.totalCard,
  }
  const diffOf = (channel: ClosingChannel): number | null => {
    const text = counted[channel]
    // เงินสดว่าง = 0 (บังคับกรอก แสดงส่วนต่างตั้งแต่ต้น เหมือนเดิม) · ช่องอื่นว่าง = ไม่ได้ตรวจ
    if (text === "" && channel !== "CASH") return null
    const value = Number(text === "" ? 0 : text)
    return Number.isFinite(value) ? round2(value - systemTotal[channel]) : null
  }
  const valid = CLOSING_CHANNELS.every((channel) => {
    const text = counted[channel]
    // ช่องว่างผ่านเสมอ (เงินสดว่างถือเป็น 0 · ช่องอื่นว่าง = ไม่ได้ตรวจ)
    if (text === "") return true
    const value = Number(text)
    return Number.isFinite(value) && value >= 0
  })

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const formData = new FormData()
    for (const channel of CLOSING_CHANNELS) {
      const text = counted[channel]
      formData.set(COUNTED_FIELD[channel], channel === "CASH" ? String(Number(text === "" ? 0 : text)) : text)
    }
    formData.set("note", note)
    formData.set("closingDate", closingDate)

    try {
      const result = await closeCashierDay(formData)
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="datatable-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
              <th style={{ padding: "8px 10px", fontWeight: 500 }}>ช่องทาง</th>
              <th style={{ padding: "8px 10px", fontWeight: 500, textAlign: "right" }}>ยอดในระบบ</th>
              <th style={{ padding: "8px 10px", fontWeight: 500 }}>ยอดจริงที่ตรวจได้</th>
              <th style={{ padding: "8px 10px", fontWeight: 500, textAlign: "right" }}>ส่วนต่าง</th>
            </tr>
          </thead>
          <tbody>
            {CLOSING_CHANNELS.map((channel) => {
              const diff = diffOf(channel)
              const idle = channel !== "CASH" && systemTotal[channel] === 0 && counted[channel] === ""
              const field = COUNTED_FIELD[channel]
              return (
                <tr key={channel} style={{ borderTop: "1px solid var(--line)", opacity: idle ? 0.55 : 1 }}>
                  <td style={{ padding: "8px 10px" }}>
                    <label htmlFor={field} style={{ fontWeight: 600 }}>
                      {CLOSING_CHANNEL_LABEL[channel]}
                      {channel === "CASH" ? <span style={{ color: "var(--danger)" }}> *</span> : null}
                    </label>
                    <br />
                    <span className="t-caption">{HINT[channel]}</span>
                  </td>
                  <td className="num" style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                    ฿{formatBaht(systemTotal[channel])}
                  </td>
                  <td style={{ padding: "8px 10px", minWidth: 130 }}>
                    <input
                      id={field}
                      className="input num"
                      inputMode="decimal"
                      required={channel === "CASH"}
                      value={counted[channel]}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, "")
                        setCounted((current) => ({ ...current, [channel]: value }))
                      }}
                      placeholder={channel === "CASH" ? "0.00" : "ไม่บังคับ"}
                    />
                    {fieldErrors[field] ? <span className="field-hint error">{fieldErrors[field]}</span> : null}
                  </td>
                  <td
                    className="num"
                    style={{
                      padding: "8px 10px",
                      textAlign: "right",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      color: diff === null || diff === 0 ? undefined : diff > 0 ? "var(--success)" : "var(--danger)",
                    }}
                  >
                    {diff === null ? <span className="t-caption">ไม่ได้ตรวจ</span> : `${diff > 0 ? "+" : ""}${formatBaht(diff)}`}
                  </td>
                </tr>
              )
            })}
            <tr style={{ borderTop: "2px solid var(--line)", background: "var(--surface-2)" }}>
              <td style={{ padding: "8px 10px", fontWeight: 600 }}>รวมทุกช่องทาง</td>
              <td className="num" style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>
                ฿{formatBaht(summary.totalSales)}
              </td>
              <td colSpan={2} className="t-caption" style={{ padding: "8px 10px" }}>
                ส่วนต่าง: เขียว = เกิน · แดง = ขาด
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="field">
        <label className="t-small" htmlFor="note">
          หมายเหตุ
        </label>
        <input
          id="note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น เหตุผลที่เงินขาด/เกิน (ไม่บังคับ)"
        />
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={pending || !valid}>
        {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
        {isToday ? "ยืนยันปิดยอดประจำวัน" : `ยืนยันปิดยอดย้อนหลัง ${formatBusinessDate(closingDate)}`}
      </button>
      <p className="t-caption">
        ปิดยอดได้วันละ 1 ครั้งต่อคน และเมื่อปิดแล้วจะยกเลิกบิลของ{isToday ? "วันนี้" : "วันที่เลือก"}ไม่ได้อีก · ยอดที่กรอกแก้ย้อนหลังไม่ได้
      </p>
    </form>
  )
}
