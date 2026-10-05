"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setSessionDiscount } from "@/app/actions/payments"
import { resolveDiscount, type DiscountMode } from "@/lib/discount"
import { formatBaht } from "@/lib/format"
import { IconSpinner } from "@/components/icons"

/// ส่วนลดของบิลโต๊ะบนหน้าปิดบิล (2026-10-05) — ต่างจากจอขายกลับบ้านตรงที่ต้อง "บันทึก" ลงบิลก่อน
/// เพราะบิลโต๊ะปิดได้หลายทาง (QR ธนาคาร/สลิป/หน้าลูกค้า) ทุกทางต้องเห็นยอดหลังหักเดียวกัน
/// · ยอดบาทจริงคิดที่ server (computeBillTotals) — ที่นี่ใช้ resolveDiscount แค่บอกข้อผิดพลาดก่อนกด
type Props = {
  sessionId: string
  itemsTotal: number
  discount: number
  discountMode: DiscountMode | null
  discountValue: number | null
  discountNote: string | null
}

export function discountLabel(mode: DiscountMode | null, value: number | null): string {
  return mode === "PERCENT" && value !== null ? `ส่วนลด ${value}%` : "ส่วนลด"
}

export function BillDiscountField({ sessionId, itemsTotal, discount, discountMode, discountValue, discountNote }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<DiscountMode>(discountMode ?? "AMOUNT")
  const [text, setText] = useState(discountValue !== null ? String(discountValue) : "")
  const [note, setNote] = useState(discountNote ?? "")
  const [pending, setPending] = useState(false)

  const value = Number(text === "" ? 0 : text)
  const check = resolveDiscount(itemsTotal, mode, value)

  async function save(clear: boolean) {
    setPending(true)
    try {
      const fd = new FormData()
      fd.set("sessionId", sessionId)
      fd.set("discountMode", mode)
      fd.set("discountValue", clear ? "0" : String(value))
      if (!clear && note.trim()) fd.set("discountNote", note.trim())
      const result = await setSessionDiscount(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      if (clear) {
        setText("")
        setNote("")
      }
      setEditing(false)
      router.refresh()
    } catch {
      toast.error("บันทึกส่วนลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        {discount > 0 ? (
          <span className="t-small">
            {discountLabel(discountMode, discountValue)}
            {discountNote ? ` (${discountNote})` : ""} <span className="num">−฿{formatBaht(discount)}</span>
          </span>
        ) : (
          <span className="t-small">ยังไม่มีส่วนลด</span>
        )}
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => setEditing(true)} disabled={pending}>
            {discount > 0 ? "แก้ส่วนลด" : "ให้ส่วนลด"}
          </button>
          {discount > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void save(true)} disabled={pending}>
              ล้างส่วนลด
            </button>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <div className="field">
      <label className="t-small" htmlFor="billDiscount">
        ส่วนลด (หักจากค่าอาหารก่อนคิดค่าบริการ)
      </label>
      <div className="row" style={{ gap: 8 }}>
        <input
          id="billDiscount"
          className="input num"
          inputMode="decimal"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="0"
          style={{ flex: 1 }}
        />
        {(["AMOUNT", "PERCENT"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`btn btn-sm ${mode === m ? "btn-primary" : "btn-subtle"}`}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
          >
            {m === "AMOUNT" ? "บาท" : "%"}
          </button>
        ))}
      </div>
      {!check.ok ? <span className="field-hint error">{check.error}</span> : null}
      <input
        className="input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="โปรโมชั่น / เหตุผล เช่น ลูกค้าประจำ"
        maxLength={60}
        aria-label="หมายเหตุส่วนลด"
      />
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={pending}>
          ยกเลิก
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save(false)} disabled={pending || !check.ok || value <= 0}>
          {pending ? <IconSpinner size={14} className="animate-spin" aria-hidden /> : null}
          ใช้ส่วนลด
        </button>
      </div>
    </div>
  )
}
