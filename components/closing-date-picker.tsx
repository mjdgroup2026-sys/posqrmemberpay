"use client"

import { useRouter } from "next/navigation"
import { IconCalendar } from "@/components/icons"

/// ตัวเลือกวันปิดรอบ (Phase 19) — เปลี่ยนแล้วพาไป `/pos/closing?date=YYYY-MM-DD` ให้ Server Component
/// คำนวณยอดของวันนั้นใหม่ · `max` กันเลือกอนาคตในเบราว์เซอร์ (ด่านจริงอยู่ที่ parseBusinessDayKey ฝั่ง server)
export function ClosingDatePicker({ value, today }: { value: string; today: string }) {
  const router = useRouter()

  return (
    <div className="field" style={{ minWidth: 220 }}>
      <label className="t-small" htmlFor="closing-date">
        <span className="row" style={{ gap: 6 }}>
          <IconCalendar size={15} aria-hidden />
          วันที่ปิดรอบ
        </span>
      </label>
      <div className="row" style={{ gap: 8 }}>
        <input
          id="closing-date"
          type="date"
          className="input num"
          value={value}
          max={today}
          onChange={(e) => {
            const next = e.target.value
            if (!next) return
            router.push(next === today ? "/pos/closing" : `/pos/closing?date=${next}`)
          }}
        />
        {value !== today ? (
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => router.push("/pos/closing")}>
            วันนี้
          </button>
        ) : null}
      </div>
    </div>
  )
}
