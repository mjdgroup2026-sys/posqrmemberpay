"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { closeCashierDay } from "@/app/actions/closing"
import { formatBaht, formatBusinessDate } from "@/lib/format"
import type { ClosingSummary } from "@/lib/queries"
import type { FieldErrors } from "@/lib/types"
import { IconSpinner } from "@/components/icons"

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/// `closingDate` = คีย์ YYYY-MM-DD ของวันทางธุรกิจที่กำลังปิด (Phase 19 — เลือกจากหน้า `/pos/closing?date=`)
/// `isToday` ใช้แค่เปลี่ยนถ้อยคำบนปุ่ม/คำเตือน ด่านจริง (ห้ามอนาคต · ปิดซ้ำไม่ได้) อยู่ที่ action
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
  const [countedText, setCountedText] = useState("")
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const counted = Number(countedText === "" ? 0 : countedText)
  const valid = Number.isFinite(counted) && counted >= 0
  const difference = round2(counted - summary.totalCash)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const formData = new FormData()
    formData.set("countedCash", String(counted))
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
      <div className="field">
        <label className="t-small" htmlFor="countedCash">
          เงินสดที่นับได้จริง (บาท) <span style={{ color: "var(--danger)" }}>*</span>
        </label>
        <input
          id="countedCash"
          className="input num"
          inputMode="decimal"
          required
          value={countedText}
          onChange={(e) => setCountedText(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0.00"
        />
        {fieldErrors.countedCash ? (
          <span className="field-hint error">{fieldErrors.countedCash}</span>
        ) : null}
      </div>

      <div
        className="row"
        style={{
          justifyContent: "space-between",
          padding: "12px 16px",
          borderRadius: 10,
          background: "var(--surface-2)",
        }}
      >
        <span className="t-small">
          ส่วนต่างเทียบยอดขายเงินสด ฿<span className="num">{formatBaht(summary.totalCash)}</span>
        </span>
        <span
          className="num"
          style={{
            fontWeight: 700,
            color: difference === 0 ? undefined : difference > 0 ? "var(--success)" : "var(--danger)",
          }}
        >
          {difference > 0 ? "+" : ""}
          {formatBaht(difference)}
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
        ปิดยอดได้วันละ 1 ครั้งต่อคน และเมื่อปิดแล้วจะยกเลิกบิลของ{isToday ? "วันนี้" : "วันที่เลือก"}ไม่ได้อีก
      </p>
    </form>
  )
}
