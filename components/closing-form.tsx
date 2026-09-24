"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { closeCashierDay } from "@/app/actions/closing"
import { formatBaht, formatBusinessDate } from "@/lib/format"
import type { ClosingSummary } from "@/lib/queries"
import { CLOSING_CHANNELS, CLOSING_CHANNEL_LABEL, COUNTED_FIELD, type ClosingChannel } from "@/lib/closing-channels"
import type { FieldErrors } from "@/lib/types"
import { IconBank, IconCard, IconCash, IconPhone, IconPlus, IconQr, IconSpinner } from "@/components/icons"

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const ICON: Record<ClosingChannel, typeof IconCash> = {
  CASH: IconCash,
  TRANSFER: IconBank,
  QR: IconQr,
  PROMPTPAY: IconPhone,
  CARD: IconCard,
}

/// ป้ายส่วนต่าง — ใช้ chip สถานะเดิม (สี + คำ ไม่พึ่งสีอย่างเดียว)
function DiffChip({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="chip chip-neutral"><span className="dot" />ไม่ได้ตรวจ</span>
  if (diff === 0) return <span className="chip chip-success"><span className="dot" />ตรงพอดี</span>
  return diff > 0 ? (
    <span className="chip chip-info num"><span className="dot" />เกิน +{formatBaht(diff)}</span>
  ) : (
    <span className="chip chip-danger num"><span className="dot" />ขาด −{formatBaht(Math.abs(diff))}</span>
  )
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
/// 20g: การ์ดทีละช่องทาง (ไอคอน · ยอดในระบบ · ช่องกรอก · ป้ายส่วนต่าง) + แถบสรุป "ตรวจแล้ว n/m · ส่วนต่างรวม" —
/// เจ้าของขอให้สวยขึ้น 2026-09-24 (ตารางเดิมเบียดในคอลัมน์ 420px) · เงินสดบังคับกรอก ช่องทางอื่นไม่บังคับ
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
  const [opened, setOpened] = useState<ClosingChannel[]>([])

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
  // ช่องทางที่แสดงเป็นการ์ด: เงินสดเสมอ · มียอดวันนี้ · กดเพิ่มเอง · หรือพิมพ์ค้างไว้ — ที่เหลือยุบเป็นปุ่มบรรทัดเดียว
  const shown = CLOSING_CHANNELS.filter(
    (channel) => channel === "CASH" || systemTotal[channel] !== 0 || opened.includes(channel) || counted[channel] !== "",
  )
  const idle = CLOSING_CHANNELS.filter((channel) => !shown.includes(channel))
  const checked = shown.filter((channel) => diffOf(channel) !== null)
  const totalDiff = round2(checked.reduce((sum, channel) => sum + (diffOf(channel) ?? 0), 0))

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
      {/* การ์ดทีละช่องทาง — เงินสดเสมอ + ช่องทางที่มียอดวันนี้ (หรือกดเพิ่มเอง) · ที่เหลือยุบเป็นปุ่มบรรทัดเดียว */}
      {shown.map((channel) => {
        const diff = diffOf(channel)
        const field = COUNTED_FIELD[channel]
        const Icon = ICON[channel]
        return (
          <div key={channel} className={`closing-channel${diff === null || diff === 0 ? "" : diff < 0 ? " is-off" : " is-over"}`}>
            <div className="closing-channel-head">
              <span className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                <span className="closing-channel-icon" aria-hidden>
                  <Icon size={18} />
                </span>
                <span>
                  <label htmlFor={field} style={{ fontWeight: 600 }}>
                    {CLOSING_CHANNEL_LABEL[channel]}
                    {channel === "CASH" ? <span style={{ color: "var(--danger)" }}> *</span> : null}
                  </label>
                  <br />
                  <span className="t-caption">{HINT[channel]}</span>
                </span>
              </span>
              <span style={{ textAlign: "right" }}>
                <span className="t-caption">ในระบบ</span>
                <br />
                <strong className="num" style={{ fontSize: "1.05rem" }}>
                  ฿{formatBaht(systemTotal[channel])}
                </strong>
              </span>
            </div>
            <div className="closing-channel-body">
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
                placeholder={channel === "CASH" ? "เงินที่นับได้ 0.00" : "ยอดที่ตรวจได้ (ไม่บังคับ)"}
                aria-describedby={`${field}-diff`}
              />
              <span id={`${field}-diff`}>
                <DiffChip diff={diff} />
              </span>
            </div>
            {fieldErrors[field] ? <span className="field-hint error">{fieldErrors[field]}</span> : null}
          </div>
        )
      })}

      {idle.length > 0 ? (
        <div className="closing-idle">
          <span className="t-caption">ไม่มียอดวันนี้:</span>
          {idle.map((channel) => (
            <button
              key={channel}
              type="button"
              className="btn btn-ghost btn-sm"
              title={`เพิ่มช่อง${CLOSING_CHANNEL_LABEL[channel]}เพื่อกรอกยอดที่ตรวจได้`}
              onClick={() => setOpened((current) => [...current, channel])}
            >
              {CLOSING_CHANNEL_LABEL[channel]} ฿0
              <IconPlus size={13} aria-hidden />
            </button>
          ))}
        </div>
      ) : null}

      {/* แถบสรุป — ตรวจไปกี่ช่อง ส่วนต่างรวมเท่าไหร่ (นับเฉพาะช่องที่กรอก) */}
      <div className="closing-summary" role="status" aria-live="polite">
        <span>
          <span className="t-caption">ยอดขายรวมทุกช่องทาง</span>
          <br />
          <strong className="num" style={{ fontSize: "1.1rem" }}>
            ฿{formatBaht(summary.totalSales)}
          </strong>
        </span>
        <span style={{ textAlign: "right" }}>
          <span className="t-caption">
            ตรวจแล้ว <span className="num">{checked.length}</span>/<span className="num">{shown.length}</span> ช่อง · ส่วนต่างรวม
          </span>
          <br />
          <DiffChip diff={checked.length === 0 ? null : totalDiff} />
        </span>
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
